use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::FrameworkError;

fn source_exts() -> HashSet<&'static str> {
    HashSet::from(["asm", "s", "mn1613", "tms9995"])
}

fn strip_line_comment(line: &str) -> &str {
    let semi = line.find(';');
    let slash = line.find("//");
    match (semi, slash) {
        (Some(a), Some(b)) => &line[..a.min(b)],
        (Some(a), None) => &line[..a],
        (None, Some(b)) => &line[..b],
        (None, None) => line,
    }
}

fn parse_include_operand(operand_text: &str) -> Result<String, FrameworkError> {
    let trimmed = operand_text.trim();
    if trimmed.is_empty() {
        return Err(FrameworkError::invalid_argument(
            "INCLUDE requires a file path.",
        ));
    }

    if ((trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
        && trimmed.len() >= 2
    {
        return Ok(trimmed[1..trimmed.len() - 1].trim().to_string());
    }

    Ok(trimmed.to_string())
}

fn expand_internal(
    source_text: &str,
    from_dir: &Path,
    include_stack: &mut Vec<PathBuf>,
) -> Result<String, FrameworkError> {
    let source_exts = source_exts();
    let abs_dir = from_dir
        .canonicalize()
        .unwrap_or_else(|_| from_dir.to_path_buf());
    let lines = source_text.replace("\r\n", "\n");
    let mut out: Vec<String> = Vec::new();

    for (idx, raw) in lines.split('\n').enumerate() {
        let body = strip_line_comment(raw).trim();
        let upper = body.to_ascii_uppercase();
        let operand = if let Some(rest) = upper.strip_prefix(".INCLUDE ") {
            Some((&body[body.len() - rest.len()..]).trim())
        } else if let Some(rest) = upper.strip_prefix("INCLUDE ") {
            Some((&body[body.len() - rest.len()..]).trim())
        } else {
            None
        };

        let Some(operand_text) = operand else {
            out.push(raw.to_string());
            continue;
        };

        let include_operand = parse_include_operand(operand_text)?;
        let include_file = {
            let p = PathBuf::from(&include_operand);
            if p.is_absolute() {
                p
            } else {
                abs_dir.join(p)
            }
        };

        let abs_include = include_file
            .canonicalize()
            .unwrap_or_else(|_| include_file.clone());

        let ext = abs_include
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if source_exts.contains(ext.as_str()) {
            return Err(FrameworkError::invalid_argument(format!(
                "Cannot .include assembler source '{include_operand}' ({}:{}). Assemble each .asm separately and link with the linker.",
                abs_dir.display(),
                idx + 1
            )));
        }

        if include_stack.iter().any(|p| p == &abs_include) {
            let mut chain: Vec<String> = include_stack
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            chain.push(abs_include.to_string_lossy().to_string());
            return Err(FrameworkError::invalid_argument(format!(
                "Include cycle detected: {}",
                chain.join(" -> ")
            )));
        }

        if !include_file.exists() {
            return Err(FrameworkError::invalid_argument(format!(
                "Include file not found: {include_operand} ({}:{})",
                abs_dir.display(),
                idx + 1
            )));
        }

        let nested = fs::read_to_string(&include_file).map_err(|e| {
            FrameworkError::invalid_argument(format!(
                "failed to read include file {}: {e}",
                include_file.display()
            ))
        })?;

        include_stack.push(abs_include.clone());
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

pub fn expand_includes(
    source_text: &str,
    from_dir: &Path,
    include_stack: Option<Vec<PathBuf>>,
) -> Result<String, FrameworkError> {
    let mut stack = include_stack.unwrap_or_default();
    expand_internal(source_text, from_dir, &mut stack)
}

pub fn expand_includes_from_file(entry_path: &Path) -> Result<String, FrameworkError> {
    let abs_path = entry_path
        .canonicalize()
        .unwrap_or_else(|_| entry_path.to_path_buf());
    let stack_entry = abs_path.clone();
    let text = fs::read_to_string(&abs_path).map_err(|e| {
        FrameworkError::invalid_argument(format!("failed to read {}: {e}", abs_path.display()))
    })?;
    expand_includes(
        &text,
        abs_path.parent().unwrap_or(Path::new(".")),
        Some(vec![stack_entry]),
    )
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
        p.push(format!("tf-rs-expand-{nanos}"));
        fs::create_dir_all(&p).expect("temp dir should be created");
        p
    }

    #[test]
    fn expands_nested_include() {
        let dir = unique_temp_dir();
        let a = dir.join("a.inc");
        let b = dir.join("b.inc");
        fs::write(&b, "VALUE\n").expect("write b");
        fs::write(&a, ".include \"b.inc\"\n").expect("write a");

        let src = "HEAD\n.include \"a.inc\"\nTAIL\n";
        let out = expand_includes(src, &dir, None).expect("expand should work");
        assert!(out.contains("HEAD"));
        assert!(out.contains("VALUE"));
        assert!(out.contains("TAIL"));

        let _ = fs::remove_file(a);
        let _ = fs::remove_file(b);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_asm_include() {
        let dir = unique_temp_dir();
        let e = expand_includes(".include \"foo.asm\"\n", &dir, None)
            .expect_err("asm include should fail");
        assert!(format!("{e}").contains("Cannot .include assembler source"));
        let _ = fs::remove_dir_all(dir);
    }
}
