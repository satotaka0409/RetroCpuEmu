//! sdld 向けリロケーション検出（`retrocpu_asm_ts/src/main/expression.ts` 相当）。

use std::collections::{HashMap, HashSet};

use crate::types::{ParsedLine, RelocOperand, RelocWidth, SymbolInfo, SymbolKind, WordDiffReloc};

/// 大文字シンボル名 → シンボル情報表。
pub type SymbolInfoTable = HashMap<String, SymbolInfo>;

/// `.globl` / `.global` で宣言された外部シンボル名を収集する。
pub fn collect_globl_names(parsed: &[ParsedLine]) -> HashSet<String> {
	let mut out = HashSet::new();
	for line in parsed {
		let Some(op) = line.op.as_ref() else {
			continue;
		};
		let op_u = op.to_ascii_uppercase();
		if op_u != ".GLOBL" && op_u != ".GLOBAL" {
			continue;
		}
		for arg in &line.args {
			out.insert(arg.to_ascii_uppercase());
		}
	}
	out
}

/// シンボル表と可視性からリロケーション用シンボル情報表を構築する。
pub fn build_symbol_infos(
	symbols: &HashMap<String, u16>,
	globl_names: &HashSet<String>,
	symbol_areas: &HashMap<String, String>,
) -> SymbolInfoTable {
	let mut infos = SymbolInfoTable::new();
	for (name, value) in symbols {
		infos.insert(
			name.clone(),
			SymbolInfo {
				value: *value,
				kind: if globl_names.contains(name) {
					SymbolKind::Global
				} else {
					SymbolKind::Local
				},
				area: symbol_areas.get(name).cloned(),
			},
		);
	}
	for name in globl_names {
		if !infos.contains_key(name) {
			infos.insert(
				name.clone(),
				SymbolInfo {
					value: 0,
					kind: SymbolKind::External,
					area: None,
				},
			);
		}
	}
	infos
}

/// 16bit オペランドから単純シンボル名を取り出す（`FOO` / `#FOO` / `@FOO` / `(FOO)`）。
pub fn parse_simple_symbol_operand(expr: &str) -> Option<String> {
	let mut t = expr.trim();
	if let Some(rest) = t.strip_prefix('#') {
		t = rest.trim();
	}
	if let Some(rest) = t.strip_prefix('@') {
		t = rest.trim();
	}
	if (t.starts_with('(') && t.ends_with(')')) || (t.starts_with('[') && t.ends_with(']')) {
		t = t[1..t.len() - 1].trim();
	}
	if !is_simple_ident(t) {
		return None;
	}
	Some(t.to_ascii_uppercase())
}

fn is_simple_ident(s: &str) -> bool {
	let mut chars = s.chars();
	let Some(first) = chars.next() else {
		return false;
	};
	if !matches!(first, 'A'..='Z' | 'a'..='z' | '_' | '.' | '$') {
		return false;
	}
	chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '$'))
}

fn to_reloc_operand(name: &str, symbol_infos: &SymbolInfoTable) -> Option<RelocOperand> {
	let info = symbol_infos.get(name)?;
	if info.kind == SymbolKind::External {
		return Some(RelocOperand::Symbol {
			name: name.to_string(),
		});
	}
	Some(RelocOperand::Word {
		value: info.value,
		area: info.area.clone(),
	})
}

/// `.word A - B` の外部アドレス差。両方確定済みなら None。
pub fn match_word_diff_reloc(
	expr: &str,
	symbol_infos: &SymbolInfoTable,
) -> Option<(RelocOperand, RelocOperand)> {
	let t = expr.trim();
	let (left_name, right_name) = parse_diff_idents(t)?;
	let left = to_reloc_operand(&left_name, symbol_infos)?;
	let right = to_reloc_operand(&right_name, symbol_infos)?;
	if matches!(left, RelocOperand::Word { .. }) && matches!(right, RelocOperand::Word { .. }) {
		return None;
	}
	Some((left, right))
}

fn parse_diff_idents(expr: &str) -> Option<(String, String)> {
	let parts: Vec<&str> = expr.split('-').map(str::trim).collect();
	if parts.len() != 2 {
		return None;
	}
	let left = parts[0];
	let right = parts[1];
	if !is_simple_ident(left) || !is_simple_ident(right) {
		return None;
	}
	Some((left.to_ascii_uppercase(), right.to_ascii_uppercase()))
}

/// リンク後の絶対ワードアドレスが必要な 16bit オペランドを検出する。
pub fn match_abs_addr_reloc(
	expr: &str,
	symbol_infos: &SymbolInfoTable,
) -> Option<(RelocOperand, RelocOperand)> {
	let name = parse_simple_symbol_operand(expr)?;
	let info = symbol_infos.get(&name)?;
	if info.kind == SymbolKind::External || info.kind == SymbolKind::Global {
		return Some((
			RelocOperand::Symbol { name },
			RelocOperand::Const { value: 0 },
		));
	}
	let area = info.area.as_deref()?.trim().to_ascii_uppercase();
	if !matches!(
		area.as_str(),
		"_CODE" | "_DATA" | "_WORK" | "_SYS_PAGE0" | "_USR_PAGE0"
	) {
		return None;
	}
	Some((
		RelocOperand::Word {
			value: info.value,
			area: Some(area),
		},
		RelocOperand::Const { value: 0 },
	))
}

/// `*SYM` / `(*SYM)` / `[*SYM]` ゼロページの 8bit リロケーションを検出する。
pub fn match_page0_star_reloc(
	expr: &str,
	symbol_infos: &SymbolInfoTable,
) -> Option<(RelocOperand, RelocOperand)> {
	let t = expr.trim();
	let name_raw = if let Some(rest) = t.strip_prefix('*') {
		rest.trim()
	} else {
		let inner = t
			.strip_prefix('(')
			.or_else(|| t.strip_prefix('['))
			.and_then(|s| s.strip_suffix(')').or_else(|| s.strip_suffix(']')))
			.map(str::trim);
		let inner = inner?;
		let rest = inner.strip_prefix('*')?.trim();
		rest
	};
	let name = parse_simple_symbol_operand(name_raw)?;
	let info = symbol_infos.get(&name)?;
	if info.kind == SymbolKind::External || info.kind == SymbolKind::Global {
		return Some((
			RelocOperand::Symbol { name },
			RelocOperand::Const { value: 0 },
		));
	}
	let area = info.area.as_deref()?.trim().to_ascii_uppercase();
	if area != "_SYS_PAGE0" && area != "_USR_PAGE0" {
		return None;
	}
	Some((
		RelocOperand::Word {
			value: info.value,
			area: Some(area),
		},
		RelocOperand::Const { value: 0 },
	))
}

/// `.word` 1 引分のプレースホルダ値とリロケーションを求める。
pub fn eval_word_arg(
	arg: &str,
	byte_mode: bool,
	current_area: &str,
	pc: u16,
	symbols: &HashMap<String, u16>,
	symbol_infos: &SymbolInfoTable,
	relocs: &mut Vec<WordDiffReloc>,
) -> Result<u16, String> {
	if match_word_diff_reloc(arg, symbol_infos).is_some() {
		return Err(format!(
			"unsupported external expression '{arg}' (sdld cannot relocate A-B; both labels must be in the same module)"
		));
	}
	if let Some((left, right)) = match_abs_addr_reloc(arg, symbol_infos) {
		let mut placeholder = match &left {
			RelocOperand::Symbol { .. } => 0,
			_ => crate::expression::eval_expr(arg, symbols, false).map_err(|e| e.to_string())? as u16,
		};
		if !byte_mode {
			if let RelocOperand::Word { .. } = left {
				placeholder = placeholder.wrapping_mul(2);
			}
		}
		relocs.push(WordDiffReloc {
			byte_addr: if byte_mode {
				pc
			} else {
				pc.wrapping_mul(2)
			},
			left,
			right,
			area: Some(current_area.to_string()),
			width: None,
		});
		return Ok(placeholder);
	}
	for (name, info) in symbol_infos {
		if info.kind != SymbolKind::External {
			continue;
		}
		if contains_word_ident(arg, name) {
			return Err(format!(
				"unsupported external expression '{arg}' (only A - B address diffs are supported)"
			));
		}
	}
	Ok(crate::expression::eval_expr(arg, symbols, false).map_err(|e| e.to_string())? as u16)
}

fn contains_word_ident(expr: &str, name: &str) -> bool {
	let upper = expr.to_ascii_uppercase();
	let key = name.to_ascii_uppercase();
	for (idx, _) in upper.match_indices(&key) {
		let before = if idx == 0 {
			'\0'
		} else {
			upper.as_bytes()[idx - 1] as char
		};
		let after_idx = idx + key.len();
		let after = if after_idx >= upper.len() {
			'\0'
		} else {
			upper.as_bytes()[after_idx] as char
		};
		if !is_ident_char(before) && !is_ident_char(after) {
			return true;
		}
	}
	false
}

fn is_ident_char(ch: char) -> bool {
	ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '$')
}

/// TMS9995 命令の追加ワード（末尾）に絶対アドレスリロケーションを適用する。
pub fn apply_tms9995_abs_reloc_to_last_word(
	line: &ParsedLine,
	symbol_infos: &SymbolInfoTable,
	words: &mut [crate::types::EmittedWord],
	relocs: &mut Vec<WordDiffReloc>,
	current_area: &str,
) {
	for arg in &line.args {
		let Some((left, right)) = match_abs_addr_reloc(arg, symbol_infos) else {
			continue;
		};
		let Some(last) = words.last_mut() else {
			return;
		};
		if matches!(left, RelocOperand::Symbol { .. }) {
			last.value = 0;
		}
		relocs.push(WordDiffReloc {
			byte_addr: last.address,
			left,
			right,
			area: Some(current_area.to_string()),
			width: None,
		});
		return;
	}
}

/// MN1613 2 語命令の第 2 語に絶対アドレスリロケーションを適用する。
pub fn apply_mn1613_abs_reloc_to_last_word(
	line: &ParsedLine,
	pc_word: u16,
	symbol_infos: &SymbolInfoTable,
	words: &mut [crate::types::EmittedWord],
	relocs: &mut Vec<WordDiffReloc>,
	current_area: &str,
) {
	for arg in &line.args {
		let Some((left, right)) = match_abs_addr_reloc(arg, symbol_infos) else {
			continue;
		};
		let Some(last) = words.last_mut() else {
			return;
		};
		match left {
			RelocOperand::Symbol { .. } => last.value = 0,
			RelocOperand::Word { .. } => last.value = last.value.wrapping_mul(2),
			RelocOperand::Const { .. } => {}
		}
		relocs.push(WordDiffReloc {
			byte_addr: (pc_word.wrapping_add(1)).wrapping_mul(2),
			left,
			right,
			area: Some(current_area.to_string()),
			width: None,
		});
		return;
	}
}

/// MN1613 1 語命令の下位 8bit にゼロページ `*label` リロケーションを適用する。
pub fn apply_mn1613_page0_reloc_to_last_word(
	line: &ParsedLine,
	pc_word: u16,
	symbol_infos: &SymbolInfoTable,
	words: &mut [crate::types::EmittedWord],
	relocs: &mut Vec<WordDiffReloc>,
	current_area: &str,
) {
	for arg in &line.args {
		let Some((left, right)) = match_page0_star_reloc(arg, symbol_infos) else {
			continue;
		};
		let Some(last) = words.last_mut() else {
			return;
		};
		match &left {
			RelocOperand::Symbol { .. } => last.value &= 0xff00,
			RelocOperand::Word { value, .. } => {
				last.value = (last.value & 0xff00) | (value.wrapping_mul(2) & 0xff);
			}
			RelocOperand::Const { .. } => {}
		}
		relocs.push(WordDiffReloc {
			byte_addr: pc_word.wrapping_mul(2).wrapping_add(1),
			left,
			right,
			area: Some(current_area.to_string()),
			width: Some(RelocWidth::Low8),
		});
		return;
	}
}
