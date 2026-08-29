//! 2 パスアセンブル（シンボル収集 → エンコード）。
//!
//! 第 1 パスで PC を進めラベル／`.equ` を確定し、第 2 パスで機械語を出力する。
//! MN1613 は `mn1613_encoder`、TMS9995 は `tms9995_encoder`。

use std::collections::HashMap;

use crate::cpu_type::{resolve_cpu_type, CpuType};
use crate::error::AsmError;
use crate::expression::{ascii_codes_from_string_arg, eval_expr};
use crate::mn1613::mn1613_encoder::{
    encode_instruction as encode_mn1613_instruction, is_two_word_op, split_ai_si_imm4_chunks,
};
use crate::tms9995::tms9995_encoder::{
    encode_instruction as encode_tms9995_instruction, instruction_size as tms9995_instruction_size,
};
use crate::parser::parse_source;
use crate::reloc::{
    apply_mn1613_abs_reloc_to_last_word, apply_mn1613_page0_reloc_to_last_word,
    build_symbol_infos, collect_globl_names, eval_word_arg,
};
use crate::types::{AddressUnit, AssemblyResult, EmittedWord, ParsedLine};

/// `.word` 引数内の `"AB"` 文字列を ASCII コード列へ展開する。
fn expand_word_args(args: &[String]) -> Result<Vec<String>, AsmError> {
    let mut out = Vec::new();
    for arg in args {
        if let Some(codes) = ascii_codes_from_string_arg(arg)? {
            for c in codes {
                out.push(format!("{c}"));
            }
        } else {
            out.push(arg.clone());
        }
    }
    Ok(out)
}

/// 疑似命令が占めるアドレス幅（第 1 パス用）。`.ds` は 0（別処理）。
fn directive_size(line: &ParsedLine, cpu: CpuType) -> Result<u16, AsmError> {
    let Some(op) = line.op.as_ref() else {
        return Ok(0);
    };
    let o = op.to_ascii_uppercase();
    if o == ".WORD" || o == ".DW" || o == "DW" {
        let words = expand_word_args(&line.args)?.len() as u16;
        if cpu == CpuType::Tms9995 {
            return Ok(words * 2);
        }
        return Ok(words);
    }
    if o == ".DS" || o == ".BLKW" {
        if line.args.len() != 1 {
            return Err(AsmError::new(format!(
                "Line {}: {} requires one argument",
                line.line_no, op
            )));
        }
        return Ok(0);
    }
    Ok(0)
}

/// MN1613 命令 1 行の語数（AI/SI の分割・2 語命令を含む）。
fn mn1613_instruction_size(
    line: &ParsedLine,
    symbols: &HashMap<String, u16>,
) -> Result<u16, AsmError> {
    let Some(op) = line.op.as_ref() else {
        return Ok(0);
    };
    let op_u = op.to_ascii_uppercase();
    if op_u.starts_with('.') {
        return Ok(0);
    }
    if op_u == "AI" || op_u == "SI" {
        if let Some(chunks) = split_ai_si_imm4_chunks(line, symbols, true)? {
            return Ok(chunks.len() as u16);
        }
    }
    if is_two_word_op(&op_u) {
        return Ok(2);
    }
    Ok(1)
}

/// `LABEL .equ` 形式（ラベル列にオペコード風トークン）の判定。
fn is_label_like(op: &str) -> bool {
    if op.starts_with('.') {
        return false;
    }
    if op.eq_ignore_ascii_case("DW") {
        return false;
    }
    true
}

/// ソース文字列をアセンブルする。
///
/// * `explicit_cpu` — CLI `--cpu` 相当。None なら先頭 `.cpu` を参照。
/// * 戻り値の `address_unit` は CPU 種別に応じ Word / Byte。
pub fn assemble(
    source_text: &str,
    explicit_cpu: Option<CpuType>,
) -> Result<AssemblyResult, AsmError> {
    let cpu = resolve_cpu_type(explicit_cpu, source_text)?;
    let address_unit = if cpu == CpuType::Tms9995 {
        AddressUnit::Byte
    } else {
        AddressUnit::Word
    };

    let (source_lines, parsed) = parse_source(source_text)?;
    let globl_names = collect_globl_names(&parsed);
    let mut symbols: HashMap<String, u16> = HashMap::new();
    let mut symbol_areas: HashMap<String, String> = HashMap::new();
    let mut pc: u16 = 0;
    const DEFAULT_AREA: &str = "_CODE";

    // --- 第 1 パス: ラベル・PC・.equ ---
    for line in &parsed {
        if let Some(label) = &line.label {
            let key = label.to_ascii_uppercase();
            if symbols.contains_key(&key) {
                return Err(AsmError::new(format!(
                    "Line {}: Duplicate symbol {}",
                    line.line_no, label
                )));
            }
            symbols.insert(key.clone(), pc);
            symbol_areas.insert(key, DEFAULT_AREA.to_string());
        }

        if line.label.is_none() && line.op.is_some() && line.args.len() >= 2 {
            let op = line.op.as_ref().expect("op exists");
            if is_label_like(op) && line.args[0].eq_ignore_ascii_case(".EQU") {
                let key = op.to_ascii_uppercase();
                let val = eval_expr(&line.args[1], &symbols, true)? as u16;
                symbols.insert(key, val);
                continue;
            }
        }

        let Some(op) = line.op.as_ref() else {
            continue;
        };
        let op_u = op.to_ascii_uppercase();
        if op_u == ".CPU" || op_u == ".AREA" || op_u == ".GLOBL" || op_u == ".GLOBAL" {
            continue;
        }
        if op_u == ".ORG" {
            if line.args.len() != 1 {
                return Err(AsmError::new(format!(
                    "Line {}: .org requires one argument",
                    line.line_no
                )));
            }
            pc = eval_expr(&line.args[0], &symbols, true)? as u16;
            continue;
        }
        if op_u == ".EQU" || op_u == "EQU" {
            if line.label.is_none() {
                return Err(AsmError::new(format!(
                    "Line {}: .equ requires a label",
                    line.line_no
                )));
            }
            if line.args.len() != 1 {
                return Err(AsmError::new(format!(
                    "Line {}: .equ requires one argument",
                    line.line_no
                )));
            }
            let v = eval_expr(&line.args[0], &symbols, true)? as u16;
            let key = line.label.as_ref().expect("label").to_ascii_uppercase();
            symbols.insert(key, v);
            continue;
        }
        if op_u == ".DS" || op_u == ".BLKW" {
            if line.args.len() != 1 {
                return Err(AsmError::new(format!(
                    "Line {}: {} requires one argument",
                    line.line_no, op
                )));
            }
            let count = eval_expr(&line.args[0], &symbols, true)?;
            if count < 0 {
                return Err(AsmError::new(format!(
                    "Line {}: {} count must not be negative",
                    line.line_no, op
                )));
            }
            let size = if cpu == CpuType::Tms9995 && op_u == ".BLKW" {
                (count as u16).wrapping_mul(2)
            } else {
                count as u16
            };
            pc = pc.wrapping_add(size);
            continue;
        }

        let size = directive_size(line, cpu)?;
        if size > 0 {
            pc = pc.wrapping_add(size);
            continue;
        }

        if cpu == CpuType::Mn1613 {
            let isz = mn1613_instruction_size(line, &symbols)?;
            if isz > 0 {
                pc = pc.wrapping_add(isz);
            }
        } else {
            let isz = tms9995_instruction_size(line)?;
            if isz > 0 {
                pc = pc.wrapping_add(isz);
            }
        }
    }

    let symbol_infos = build_symbol_infos(&symbols, &globl_names, &symbol_areas);
    let mut words: Vec<EmittedWord> = Vec::new();
    let mut relocs = Vec::new();
    let mut storage_addrs: HashMap<usize, u16> = HashMap::new();
    pc = 0;
    let byte_mode = cpu == CpuType::Tms9995;
    // --- 第 2 パス: 機械語出力 ---
    for line in &parsed {
        let Some(op) = line.op.as_ref() else {
            continue;
        };
        let op_u = op.to_ascii_uppercase();
        if op_u == ".CPU" || op_u == ".AREA" || op_u == ".GLOBL" || op_u == ".GLOBAL" {
            continue;
        }
        if op_u == ".ORG" {
            pc = eval_expr(
                line.args.first().map(|s| s.as_str()).unwrap_or("0"),
                &symbols,
                false,
            )? as u16;
            continue;
        }
        if op_u == ".EQU" || op_u == "EQU" {
            continue;
        }
        if op_u == ".DS" || op_u == ".BLKW" {
            let count = eval_expr(
                line.args.first().map(|s| s.as_str()).unwrap_or("0"),
                &symbols,
                false,
            )? as u16;
            storage_addrs.insert(line.line_no, pc);
            let size = if cpu == CpuType::Tms9995 && op_u == ".BLKW" {
                count.wrapping_mul(2)
            } else {
                count
            };
            pc = pc.wrapping_add(size);
            continue;
        }
        if op_u == ".WORD" || op_u == ".DW" || op_u == "DW" {
            let ex = expand_word_args(&line.args)?;
            for a in &ex {
                let v = eval_word_arg(
                    a,
                    byte_mode,
                    DEFAULT_AREA,
                    pc,
                    &symbols,
                    &symbol_infos,
                    &mut relocs,
                )
                .map_err(AsmError::new)?;
                words.push(EmittedWord {
                    address: pc,
                    value: v,
                    line_no: line.line_no,
                    source: line.text.clone(),
                });
                pc = if byte_mode {
                    pc.wrapping_add(2)
                } else {
                    pc.wrapping_add(1)
                };
            }
            continue;
        }
        if op_u.starts_with('.') {
            continue;
        }

        if cpu == CpuType::Mn1613 {
            let pc_word = pc;
            let mut symbols_for_encode = symbols.clone();
            for (name, info) in &symbol_infos {
                if info.kind == crate::types::SymbolKind::External
                    && !symbols_for_encode.contains_key(name)
                {
                    symbols_for_encode.insert(name.clone(), 0);
                }
            }
            let encoded = encode_mn1613_instruction(line, pc_word, &symbols_for_encode, false)
                .map_err(|e| {
                AsmError::new(format!(
                    "Line {}: {} ({})",
                    line.line_no,
                    e,
                    line.text.trim()
                ))
            })?;
            let encoded_len = encoded.len();
            let word_start = words.len();
            for w in encoded {
                words.push(EmittedWord {
                    address: pc,
                    value: w,
                    line_no: line.line_no,
                    source: line.text.clone(),
                });
                pc = pc.wrapping_add(1);
            }
            if encoded_len >= 2 {
                apply_mn1613_abs_reloc_to_last_word(
                    line,
                    pc_word,
                    &symbol_infos,
                    &mut words[word_start..],
                    &mut relocs,
                    DEFAULT_AREA,
                );
            }
            if encoded_len == 1 {
                apply_mn1613_page0_reloc_to_last_word(
                    line,
                    pc_word,
                    &symbol_infos,
                    &mut words[word_start..],
                    &mut relocs,
                    DEFAULT_AREA,
                );
            }
        } else {
            let encoded = encode_tms9995_instruction(line, pc, &symbols, false).map_err(|e| {
                AsmError::new(format!(
                    "Line {}: {} ({})",
                    line.line_no,
                    e,
                    line.text.trim()
                ))
            })?;
            for w in encoded {
                words.push(EmittedWord {
                    address: pc,
                    value: w,
                    line_no: line.line_no,
                    source: line.text.clone(),
                });
                pc = pc.wrapping_add(2);
            }
        }
    }

    Ok(AssemblyResult {
        words,
        symbols,
        source_lines,
        cpu_type: cpu,
        address_unit,
        storage_addrs,
        symbol_infos,
        relocs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assemble_word_and_equ() {
        let src = "  .cpu mn1613\nMAIN: .equ 0x10\nLBL: .word 1, 'A'\n";
        let r = assemble(src, None).expect("assemble");
        assert_eq!(r.symbols.get("MAIN"), Some(&0x10));
        assert_eq!(r.words.len(), 2);
        assert_eq!(r.words[1].value, 65);
    }

    #[test]
    fn assemble_word_label_reloc_placeholder() {
        let src = "  .cpu mn1613\n  .org 0\n  .word 0,0,0,0,0,0\nRELDATA: .word 0x1234\nRELPTR: .word RELDATA\n";
        let r = assemble(src, None).expect("assemble");
        assert_eq!(r.words.last().map(|w| w.value), Some(0x000c));
        assert_eq!(r.relocs.len(), 1);
    }
}
