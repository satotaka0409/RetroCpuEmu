//! pest による 1 行本体の構文解析。

use pest::error::LineColLocation;
use pest::Parser;
use pest_derive::Parser;

use crate::error::AsmError;

#[derive(Parser)]
#[grammar = "parser/grammar.pest"]
pub struct AsmGrammar;

/// SDAS 流 `NAME .ds` / `NAME .blkw`（コロンなし）を拒否する。
fn reject_storage_without_colon(body: &str, line_no: usize) -> Result<(), AsmError> {
    if body.contains(':') {
        return Ok(());
    }
    let Some(rest) = body
        .trim_start()
        .split_once(|c: char| c.is_ascii_whitespace())
    else {
        return Ok(());
    };
    let (name, tail) = rest;
    if !is_label_ident(name) {
        return Ok(());
    }
    let upper = tail.trim_start().to_ascii_uppercase();
    for dir in [".DS", ".BLKW"] {
        if upper == dir || upper.starts_with(&format!("{dir} ")) {
            return Err(AsmError::new(format!(
                "Line {line_no}: {dir} label must end with ':' (write {name}: {dir} ...)"
            )));
        }
    }
    Ok(())
}

fn is_label_ident(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '.' || first == '$') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '$')
}

fn normalize_equ_op(raw: &str) -> String {
    let u = raw.to_ascii_uppercase();
    if u.starts_with('.') {
        ".EQU".to_string()
    } else {
        "EQU".to_string()
    }
}

fn format_pest_error(e: pest::error::Error<Rule>, line_no: usize) -> String {
    let col = match e.line_col {
        LineColLocation::Pos((_, col)) => col,
        LineColLocation::Span((_, start), _) => start,
    };
    format!(
        "Parse error at line {line_no} (col {col}): {}",
        e.variant
    )
}

fn extract_args(arg_list: pest::iterators::Pair<'_, Rule>) -> Vec<String> {
    arg_list
        .into_inner()
        .filter(|p| p.as_rule() == Rule::arg)
        .map(|arg| arg.as_str().trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn tail_args(tail: pest::iterators::Pair<'_, Rule>) -> Vec<String> {
    tail.into_inner()
        .find(|p| p.as_rule() == Rule::arg_list)
        .map(extract_args)
        .unwrap_or_default()
}

fn label_name(label: pest::iterators::Pair<'_, Rule>) -> String {
    let fallback = label.as_str().trim_end_matches(':').to_string();
    label
        .into_inner()
        .find(|p| p.as_rule() == Rule::label_ident)
        .map(|p| p.as_str().to_string())
        .unwrap_or(fallback)
}

fn parse_content_pair(
    body: &str,
    line_no: usize,
) -> Result<pest::iterators::Pair<'_, Rule>, AsmError> {
    let mut pairs = AsmGrammar::parse(Rule::asm_content, body)
        .map_err(|e| AsmError::new(format_pest_error(e, line_no)))?;
    let root = pairs.next().expect("asm_content root");
    if root.as_span().end() != body.len() {
        return Err(AsmError::new(format!(
            "Parse error at line {line_no}: unexpected trailing input"
        )));
    }
    let content = match root.as_rule() {
        Rule::asm_content => root
            .into_inner()
            .next()
            .ok_or_else(|| AsmError::new(format!("Parse error at line {line_no}: empty line")))?,
        Rule::sdas_equ | Rule::labeled_instr | Rule::unlabeled_instr => return Ok(root),
        _ => {
            return Err(AsmError::new(format!(
                "Parse error at line {line_no}: unexpected rule"
            )));
        }
    };
    if content.as_span().end() != body.len() {
        return Err(AsmError::new(format!(
            "Parse error at line {line_no}: unexpected trailing input"
        )));
    }
    Ok(content)
}

/// コメント除去・字下げ済み 1 行を pest で分解する。
pub fn parse_body(
    body: &str,
    line_no: usize,
) -> Result<(Option<String>, Option<String>, Vec<String>), AsmError> {
    reject_storage_without_colon(body, line_no)?;

    let content = parse_content_pair(body, line_no)?;

    match content.as_rule() {
        Rule::sdas_equ => {
            let mut inner = content.into_inner();
            let label = inner
                .find(|p| p.as_rule() == Rule::label_ident)
                .expect("label_ident")
                .as_str()
                .to_string();
            let equ_raw = inner
                .find(|p| p.as_rule() == Rule::equ_op)
                .expect("equ_op")
                .as_str();
            let value = inner
                .find(|p| p.as_rule() == Rule::equ_tail)
                .expect("equ_tail")
                .as_str()
                .trim()
                .to_string();
            Ok((Some(label), Some(normalize_equ_op(equ_raw)), vec![value]))
        }
        Rule::labeled_instr => {
            let mut inner = content.into_inner();
            let label = label_name(inner.next().expect("label"));
            let (op, args) = inner
                .find(|p| p.as_rule() == Rule::labeled_tail)
                .map(|tail| {
                    let mut op = String::new();
                    let mut args = Vec::new();
                    for part in tail.into_inner() {
                        match part.as_rule() {
                            Rule::opcode => op = part.as_str().to_ascii_uppercase(),
                            Rule::op_tail => args = tail_args(part),
                            _ => {}
                        }
                    }
                    (op, args)
                })
                .unwrap_or((String::new(), Vec::new()));
            let op = if op.is_empty() { None } else { Some(op) };
            Ok((Some(label), op, args))
        }
        Rule::unlabeled_instr => {
            let mut op = String::new();
            let mut args = Vec::new();
            for part in content.into_inner() {
                match part.as_rule() {
                    Rule::opcode => op = part.as_str().to_ascii_uppercase(),
                    Rule::op_tail => args = tail_args(part),
                    _ => {}
                }
            }
            Ok((None, Some(op), args))
        }
        _ => Err(AsmError::new(format!(
            "Parse error at line {line_no}: unexpected rule"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_label_opcode_args() {
        let (label, op, args) = parse_body("MAIN: .word 1, 2", 1).expect("parse");
        assert_eq!(label.as_deref(), Some("MAIN"));
        assert_eq!(op.as_deref(), Some(".WORD"));
        assert_eq!(args, vec!["1", "2"]);
    }

    #[test]
    fn parses_sdas_equ_without_colon() {
        let (label, op, args) = parse_body("COUNT .equ 10", 1).expect("parse");
        assert_eq!(label.as_deref(), Some("COUNT"));
        assert_eq!(op.as_deref(), Some(".EQU"));
        assert_eq!(args, vec!["10"]);
    }

    #[test]
    fn parses_tms9995_addressing_operands() {
        let (_, _, args_paren) = parse_body("MOV\t(R3), R0", 1).expect("paren");
        assert_eq!(args_paren, vec!["(R3)", "R0"]);

        let (_, op, args) = parse_body("MOV\tIDX(R1), R2", 1).expect("idx");
        assert_eq!(op.as_deref(), Some("MOV"));
        assert_eq!(args, vec!["IDX(R1)", "R2"]);

        let (_, _, args2) = parse_body("MOV\t[R10], R0", 1).expect("bracket");
        assert_eq!(args2, vec!["[R10]", "R0"]);
    }
}
