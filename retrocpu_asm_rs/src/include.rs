//! `.include` / `INCLUDE` の再帰展開。
//!
//! エントリ `.asm` を読み、include 行を子ファイル内容へ置換する。
//! 循環 include は検出してエラーにする。

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AsmError;
use crate::parser::strip_line_comment;

/// include 行のパス引数を解釈（`"path"` / `'path'` / 裸パス）。
fn parse_include_operand(operand_text: &str) -> Result<String, AsmError> {
	let trimmed = operand_text.trim();
	if trimmed.is_empty() {
		return Err(AsmError::new("INCLUDE requires a file path."));
	}
	if ((trimmed.starts_with('"') && trimmed.ends_with('"'))
		|| (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
		&& trimmed.len() >= 2
	{
		return Ok(trimmed[1..trimmed.len() - 1].trim().to_string());
	}
	Ok(trimmed.to_string())
}

/// エントリファイルから include を再帰展開したソース文字列を返す。
///
/// * `include_stack` — 循環検出用。通常は `None`。
/// * 相対パスは include 元ファイルのディレクトリ基準。
pub fn expand_includes_from_file(
	entry_path: &Path,
	include_stack: Option<Vec<PathBuf>>,
) -> Result<String, AsmError> {
	let abs_path = entry_path
		.canonicalize()
		.unwrap_or_else(|_| entry_path.to_path_buf());
	let mut stack = include_stack.unwrap_or_default();
	if stack.iter().any(|p| p == &abs_path) {
		let mut cycle: Vec<String> = stack.iter().map(|p| p.display().to_string()).collect();
		cycle.push(abs_path.display().to_string());
		return Err(AsmError::new(format!(
			"Include cycle detected: {}",
			cycle.join(" -> ")
		)));
	}
	stack.push(abs_path.clone());

	let text = fs::read_to_string(&abs_path)
		.map_err(|e| AsmError::new(format!("failed to read {}: {e}", abs_path.display())))?;
	let mut out: Vec<String> = Vec::new();

	for (idx, raw) in text.replace("\r\n", "\n").split('\n').enumerate() {
		let body = strip_line_comment(raw).trim().to_string();
		let upper = body.to_ascii_uppercase();
		let operand_text = if let Some(rest) = upper.strip_prefix(".INCLUDE ") {
			Some((&body[body.len() - rest.len()..]).trim())
		} else if let Some(rest) = upper.strip_prefix("INCLUDE ") {
			Some((&body[body.len() - rest.len()..]).trim())
		} else {
			None
		};

		let Some(operand_text) = operand_text else {
			out.push(raw.to_string());
			continue;
		};

		let include_operand = parse_include_operand(operand_text)?;
		let include_file = {
			let p = PathBuf::from(&include_operand);
			if p.is_absolute() {
				p
			} else {
				abs_path
					.parent()
					.unwrap_or(Path::new("."))
					.join(include_operand)
			}
		};

		if !include_file.exists() {
			return Err(AsmError::new(format!(
				"Include file not found: {} ({}:{})",
				include_file.display(),
				abs_path.display(),
				idx + 1
			)));
		}

		out.push(expand_includes_from_file(
			&include_file,
			Some(stack.clone()),
		)?);
	}

	Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn expands_includes() {
		let mut d = std::env::temp_dir();
		d.push(format!(
			"asm-rs-include-{}",
			std::time::SystemTime::now()
				.duration_since(std::time::UNIX_EPOCH)
				.unwrap_or_default()
				.as_nanos()
		));
		std::fs::create_dir_all(&d).expect("mkdir");
		let a = d.join("a.asm");
		let b = d.join("b.inc");
		std::fs::write(&b, "X\n").expect("write b");
		std::fs::write(&a, ".include \"b.inc\"\n").expect("write a");

		let s = expand_includes_from_file(&a, None).expect("expand");
		assert!(s.contains('X'));

		let _ = std::fs::remove_file(a);
		let _ = std::fs::remove_file(b);
		let _ = std::fs::remove_dir_all(d);
	}
}
