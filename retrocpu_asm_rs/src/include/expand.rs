//! `.include` / `INCLUDE` の再帰展開（TS `cli.ts` の `expandIncludesFromFile` 相当）。

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AsmError;
use crate::parser::strip_line_comment;

use super::operand::parse_include_operand;

/// include 行かどうかを判定し、オペランド部分を返す。
fn match_include_operand(body: &str) -> Option<&str> {
    let upper = body.to_ascii_uppercase();
    if let Some(rest) = upper.strip_prefix(".INCLUDE ") {
        Some(body[body.len() - rest.len()..].trim())
    } else if let Some(rest) = upper.strip_prefix("INCLUDE ") {
        Some(body[body.len() - rest.len()..].trim())
    } else {
        None
    }
}

fn resolve_include_path(from_dir: &Path, operand: &str) -> PathBuf {
    let p = PathBuf::from(operand);
    if p.is_absolute() {
        p
    } else {
        from_dir.join(p)
    }
}

fn detect_cycle(include_stack: &[PathBuf], abs_include: &Path) -> Result<(), AsmError> {
    if include_stack.iter().any(|p| p == abs_include) {
        let mut chain: Vec<String> = include_stack
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        chain.push(abs_include.display().to_string());
        return Err(AsmError::new(format!(
            "Include cycle detected: {}",
            chain.join(" -> ")
        )));
    }
    Ok(())
}

fn expand_internal(
    source_text: &str,
    from_dir: &Path,
    include_stack: &mut Vec<PathBuf>,
) -> Result<String, AsmError> {
    let abs_dir = from_dir
        .canonicalize()
        .unwrap_or_else(|_| from_dir.to_path_buf());
    let mut out: Vec<String> = Vec::new();

    for (idx, raw) in source_text.replace("\r\n", "\n").split('\n').enumerate() {
        let body = strip_line_comment(raw).trim().to_string();
        let Some(operand_text) = match_include_operand(&body) else {
            out.push(raw.to_string());
            continue;
        };

        let include_operand = parse_include_operand(operand_text)?;
        let include_file = resolve_include_path(&abs_dir, &include_operand);
        let abs_include = include_file
            .canonicalize()
            .unwrap_or_else(|_| include_file.clone());

        detect_cycle(include_stack, &abs_include)?;

        if !include_file.exists() {
            return Err(AsmError::new(format!(
                "Include file not found: {include_operand} ({}:{})",
                abs_dir.display(),
                idx + 1
            )));
        }

        let nested = fs::read_to_string(&include_file).map_err(|e| {
            AsmError::new(format!(
                "failed to read include file {}: {e}",
                include_file.display()
            ))
        })?;

        include_stack.push(abs_include);
        let expanded = expand_internal(
            &nested,
            include_file.parent().unwrap_or(abs_dir.as_path()),
            include_stack,
        )?;
        include_stack.pop();

        out.push(expanded);
    }

    Ok(out.join("\n"))
}

/// ソース文字列中の include 行を再帰展開する。
///
/// 相対パスは `from_dir` 基準。`include_stack` は循環検出用（通常は `None`）。
pub fn expand_includes(
    source_text: &str,
    from_dir: &Path,
    include_stack: Option<Vec<PathBuf>>,
) -> Result<String, AsmError> {
    let mut stack = include_stack.unwrap_or_default();
    expand_internal(source_text, from_dir, &mut stack)
}

/// エントリ `.asm` から include を再帰展開したソース全文を返す。
///
/// 相対パスは include 元ファイルのディレクトリ基準。`include_stack` は循環検出用（通常は `None`）。
pub fn expand_includes_from_file(
    entry_path: &Path,
    include_stack: Option<Vec<PathBuf>>,
) -> Result<String, AsmError> {
    let abs_path = entry_path
        .canonicalize()
        .unwrap_or_else(|_| entry_path.to_path_buf());

    let mut stack = include_stack.unwrap_or_default();
    detect_cycle(&stack, &abs_path)?;

    let text = fs::read_to_string(&abs_path)
        .map_err(|e| AsmError::new(format!("failed to read {}: {e}", abs_path.display())))?;

    stack.push(abs_path.clone());
    let expanded = expand_internal(
        &text,
        abs_path.parent().unwrap_or(Path::new(".")),
        &mut stack,
    )?;
    Ok(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        p.push(format!("asm-rs-include-{nanos}"));
        fs::create_dir_all(&p).expect("temp dir");
        p
    }

    #[test]
    fn expands_includes() {
        let d = unique_temp_dir();
        let a = d.join("a.asm");
        let b = d.join("b.inc");
        fs::write(&b, "X\n").expect("write b");
        fs::write(&a, ".include \"b.inc\"\n").expect("write a");

        let s = expand_includes_from_file(&a, None).expect("expand");
        assert!(s.contains('X'));

        let _ = fs::remove_file(a);
        let _ = fs::remove_file(b);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn expands_nested_include() {
        let dir = unique_temp_dir();
        let a = dir.join("a.inc");
        let b = dir.join("b.inc");
        fs::write(&b, "VALUE\n").expect("write b");
        fs::write(&a, ".include \"b.inc\"\n").expect("write a");

        let src = "HEAD\n.include \"a.inc\"\nTAIL\n";
        let out = expand_includes(src, &dir, None).expect("expand");
        assert!(out.contains("HEAD"));
        assert!(out.contains("VALUE"));
        assert!(out.contains("TAIL"));
        assert!(!out.contains(".include"));

        let _ = fs::remove_file(a);
        let _ = fs::remove_file(b);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_include_cycle() {
        let dir = unique_temp_dir();
        let a = dir.join("a.asm");
        let b = dir.join("b.asm");
        fs::write(&a, "INCLUDE \"b.asm\"\n").expect("write a");
        fs::write(&b, "INCLUDE \"a.asm\"\n").expect("write b");

        let err = expand_includes_from_file(&a, None).expect_err("cycle");
        assert!(err.to_string().contains("Include cycle detected"));

        let _ = fs::remove_file(a);
        let _ = fs::remove_file(b);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_missing_include_file() {
        let dir = unique_temp_dir();
        let main = dir.join("main.asm");
        fs::write(&main, "INCLUDE \"notexist.inc\"\n").expect("write main");

        let err = expand_includes_from_file(&main, None).expect_err("missing");
        assert!(err.to_string().contains("Include file not found"));

        let _ = fs::remove_file(main);
        let _ = fs::remove_dir_all(dir);
    }
}
