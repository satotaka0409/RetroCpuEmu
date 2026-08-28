//! ソース行のパース（ラベル・オペコード・引数分割）。
//!
//! sdas 互換: 疑似命令は先頭列に置かずインデントする。`;` / `//` コメントは
//! 引用符外のみ有効。

use crate::error::AsmError;
use crate::types::{ParsedLine, SourceLine};

/// 行末コメントを除去する（`'` / `"` 内の `;` は残す）。
pub fn strip_line_comment(line: &str) -> String {
	let mut i = 0usize;
	let bytes = line.as_bytes();
	let mut quote: Option<u8> = None;
	while i < bytes.len() {
		let ch = bytes[i];
		if let Some(q) = quote {
			if ch == q {
				quote = None;
			}
			i += 1;
			continue;
		}
		if ch == b'\'' || ch == b'"' {
			quote = Some(ch);
			i += 1;
			continue;
		}
		if ch == b';' {
			return line[..i].to_string();
		}
		if ch == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
			return line[..i].to_string();
		}
		i += 1;
	}
	line.to_string()
}

/// カンマ区切り引数を分割（括弧・引用符内のカンマは無視）。
fn parse_args(s: &str) -> Vec<String> {
	let mut out = Vec::new();
	let mut cur = String::new();
	let mut q: Option<char> = None;
	let mut paren = 0i32;
	let mut bracket = 0i32;
	for ch in s.chars() {
		if let Some(qq) = q {
			cur.push(ch);
			if ch == qq {
				q = None;
			}
			continue;
		}
		match ch {
			'\'' | '"' => {
				q = Some(ch);
				cur.push(ch);
			}
			'(' => {
				paren += 1;
				cur.push(ch);
			}
			')' => {
				paren -= 1;
				cur.push(ch);
			}
			'[' => {
				bracket += 1;
				cur.push(ch);
			}
			']' => {
				bracket -= 1;
				cur.push(ch);
			}
			',' if paren == 0 && bracket == 0 => {
				let t = cur.trim();
				if !t.is_empty() {
					out.push(t.to_string());
				}
				cur.clear();
			}
			_ => cur.push(ch),
		}
	}
	let t = cur.trim();
	if !t.is_empty() {
		out.push(t.to_string());
	}
	out
}

/// 1 行本体をラベル・オペコード・引数に分解する。
fn parse_body(
	body: &str,
	line_no: usize,
) -> Result<(Option<String>, Option<String>, Vec<String>), AsmError> {
	let mut label: Option<String> = None;
	let mut rest = body.trim_start();

	// `LABEL:` — 先頭が識別子らしければラベル
	if let Some(colon_idx) = rest.find(':') {
		let cand = rest[..colon_idx].trim();
		if !cand.is_empty()
			&& cand
				.chars()
				.next()
				.map(|c| c.is_ascii_alphabetic() || c == '_' || c == '.' || c == '$')
				.unwrap_or(false)
			&& cand
				.chars()
				.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '$')
		{
			label = Some(cand.to_string());
			rest = rest[colon_idx + 1..].trim_start();
		}
	}

	if rest.is_empty() {
		return Ok((label, None, Vec::new()));
	}

	let mut parts = rest.splitn(2, char::is_whitespace);
	let op = parts.next().unwrap_or_default().to_ascii_uppercase();
	let tail = parts.next().unwrap_or("").trim();
	let args = if tail.is_empty() {
		Vec::new()
	} else {
		parse_args(tail)
	};

	if op.is_empty() {
		return Err(AsmError::new(format!(
			"Parse error at line {}: opcode expected",
			line_no
		)));
	}

	Ok((label, Some(op), args))
}

/// ソース全文を行単位でパースする。
pub fn parse_source(text: &str) -> Result<(Vec<SourceLine>, Vec<ParsedLine>), AsmError> {
	let mut source_lines = Vec::new();
	let mut parsed = Vec::new();

	for (idx, raw) in text.replace("\r\n", "\n").split('\n').enumerate() {
		let line_no = idx + 1;
		source_lines.push(SourceLine {
			line_no,
			text: raw.to_string(),
		});

		let stripped = strip_line_comment(raw);
		let body = stripped.trim();
		if body.is_empty() {
			parsed.push(ParsedLine {
				line_no,
				text: raw.to_string(),
				label: None,
				op: None,
				args: Vec::new(),
			});
			continue;
		}

		// sdas: 先頭列の `.` は疑似命令禁止（ラベル列と分離）
		if stripped.starts_with('.') {
			return Err(AsmError::new(format!(
				"Line {}: pseudo-op must not start in column 1 (indent .cpu/.area/.org/.include/.equ; labels go in column 1)",
				line_no
			)));
		}

		let (label, op, args) = parse_body(body, line_no)?;
		parsed.push(ParsedLine {
			line_no,
			text: raw.to_string(),
			label,
			op,
			args,
		});
	}

	Ok((source_lines, parsed))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn strips_comments_with_quotes() {
		assert_eq!(strip_line_comment(".dw \"A;B\" ; c"), ".dw \"A;B\" ");
	}

	#[test]
	fn parses_basic_line() {
		let src = "MAIN: .word 1, 2\n";
		let (_s, p) = parse_source(src).expect("parse");
		assert_eq!(p[0].label.as_deref(), Some("MAIN"));
		assert_eq!(p[0].op.as_deref(), Some(".WORD"));
		assert_eq!(p[0].args, vec!["1", "2"]);
	}
}
