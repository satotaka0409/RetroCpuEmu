//! `.include` / `INCLUDE` 行のオペランド解釈。

use crate::error::AsmError;

/// include 行のパス引数を解釈する（`"path"` / `'path'` / 裸パス）。
pub fn parse_include_operand(operand_text: &str) -> Result<String, AsmError> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_quoted_and_bare_paths() {
        assert_eq!(
            parse_include_operand("\"foo.inc\"").expect("double quote"),
            "foo.inc"
        );
        assert_eq!(
            parse_include_operand("'bar.inc'").expect("single quote"),
            "bar.inc"
        );
        assert_eq!(
            parse_include_operand("bare.inc").expect("bare"),
            "bare.inc"
        );
    }

    #[test]
    fn rejects_empty_operand() {
        assert!(parse_include_operand("   ").is_err());
    }
}
