//! ソース行のパース（ラベル・オペコード・引数分割）。
//!
//! sdas 互換: 疑似命令は先頭列に置かずインデントする。`;` / `//` コメントは
//! 引用符外のみ有効。行本体は [pest](https://pest.rs/) で解析する。

mod comment;
mod pest_parse;

pub use comment::strip_line_comment;
pub use pest_parse::parse_body;

use crate::error::AsmError;
use crate::types::{ParsedLine, SourceLine};

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
                "Line {line_no}: pseudo-op must not start in column 1 (indent .cpu/.area/.org/.include/.equ; labels go in column 1)"
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
    fn parses_basic_line() {
        let src = "MAIN: .word 1, 2\n";
        let (_s, p) = parse_source(src).expect("parse");
        assert_eq!(p[0].label.as_deref(), Some("MAIN"));
        assert_eq!(p[0].op.as_deref(), Some(".WORD"));
        assert_eq!(p[0].args, vec!["1", "2"]);
    }
}
