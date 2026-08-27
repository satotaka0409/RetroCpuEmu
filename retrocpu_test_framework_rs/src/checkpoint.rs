use std::collections::HashMap;

use crate::error::FrameworkError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckpointEmit {
    pub name: String,
    pub serial: String,
    pub anchor_name: String,
}

#[derive(Debug, Clone, Default)]
pub struct CheckpointInjectState {
    pub by_name: HashMap<String, u32>,
    pub unique: u32,
    pub emitted: Vec<CheckpointEmit>,
}

const SKIP_PSEUDO: &[&str] = &[
    "cpu", "area", "org", "include", "equ", "globl", "global", "macro", "endm", "if", "else",
    "endif", "ifdef", "ifndef", "list", "nlist", "module",
];

pub fn create_checkpoint_state() -> CheckpointInjectState {
    CheckpointInjectState::default()
}

pub fn checkpoint_id(name: &str, serial: &str) -> String {
    format!("__CP${name}${serial}")
}

pub fn is_synthetic_checkpoint_global(name: &str) -> bool {
    if name.len() == 8 && name[..4].eq_ignore_ascii_case("__CP") {
        return name[4..].chars().all(|c| c.is_ascii_digit());
    }
    name.to_ascii_uppercase().starts_with("__CP$")
}

fn is_comment_or_blank(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with(';')
}

fn strip_leading_label(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    if i >= bytes.len() {
        return "";
    }
    let c0 = bytes[i] as char;
    if !(c0.is_ascii_alphabetic() || c0 == '_' || c0 == '.' || c0 == '$') {
        return &line[i..];
    }
    let mut j = i + 1;
    while j < bytes.len() {
        let c = bytes[j] as char;
        if c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '$' {
            j += 1;
        } else {
            break;
        }
    }
    if j < bytes.len() && bytes[j] as char == ':' {
        &line[j + 1..]
    } else {
        &line[i..]
    }
}

fn is_skip_directive(line: &str) -> bool {
    let body = strip_leading_label(line).trim();
    if body.is_empty() || body.starts_with(';') {
        return true;
    }
    let Some(rest) = body.strip_prefix('.') else {
        return false;
    };
    let directive: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    SKIP_PSEUDO.contains(&directive.as_str())
}

fn parse_cp_name(raw: Option<&str>) -> Result<String, FrameworkError> {
    let name = raw.unwrap_or("").trim();
    let valid = {
        let mut chars = name.chars();
        match chars.next() {
            Some(c) if c.is_ascii_alphabetic() || c == '_' => {
                chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
            }
            _ => false,
        }
    };

    if !valid {
        return Err(FrameworkError::invalid_argument(format!(
            "invalid checkpoint name \"{}\" (; @cp uses [A-Za-z_][A-Za-z0-9_]*)",
            name
        )));
    }
    Ok(name.to_string())
}

fn find_cp_token(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    for i in 0..bytes.len() {
        let c = bytes[i] as char;
        if c != ';' {
            continue;
        }
        let mut j = i + 1;
        while j < bytes.len() && (bytes[j] as char).is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() {
            continue;
        }
        let at = bytes[j] as char;
        if at != '@' && at != '＠' {
            continue;
        }
        j += 1;
        if j + 1 >= bytes.len() {
            continue;
        }
        let c1 = bytes[j] as char;
        let c2 = bytes[j + 1] as char;
        if (c1 == 'c' || c1 == 'C') && (c2 == 'p' || c2 == 'P') {
            return Some(i);
        }
    }
    None
}

fn cp_name_from_comment(comment_body: &str) -> Result<String, FrameworkError> {
    let mut s = comment_body.trim_start();
    if let Some(rest) = s.strip_prefix('@') {
        s = rest;
    } else if let Some(rest) = s.strip_prefix('＠') {
        s = rest;
    }
    if s.len() < 2 || !s[..2].eq_ignore_ascii_case("cp") {
        return Err(FrameworkError::invalid_argument(
            "invalid @cp token".to_string(),
        ));
    }
    s = &s[2..];
    parse_cp_name(Some(s))
}

fn alloc_checkpoint(state: &mut CheckpointInjectState, name: String) -> usize {
    let next = state.by_name.get(&name).copied().unwrap_or(0) + 1;
    state.by_name.insert(name.clone(), next);
    state.emitted.push(CheckpointEmit {
        name,
        serial: format!("{next:04}"),
        anchor_name: String::new(),
    });
    state.emitted.len() - 1
}

fn alloc_anchor(state: &mut CheckpointInjectState) -> Result<String, FrameworkError> {
    state.unique += 1;
    if state.unique > 9999 {
        return Err(FrameworkError::invalid_argument(
            "too many checkpoint anchors (serial overflow)".to_string(),
        ));
    }
    Ok(format!("__CP{:04}", state.unique))
}

fn synthetic_anchor_block(anchor: &str) -> String {
    format!("\t.globl\t{anchor}\n{anchor}:")
}

pub fn inject_checkpoints(
    source_text: &str,
    state: &mut CheckpointInjectState,
) -> Result<String, FrameworkError> {
    let nl = if source_text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let normalized = source_text.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();

    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 8);
    let mut pending: Vec<usize> = Vec::new();

    for line in lines {
        if let Some(cp_idx) = find_cp_token(line) {
            let is_only = line[..cp_idx].trim().is_empty();
            let comment = &line[cp_idx + 1..];
            let cp_name = cp_name_from_comment(comment)?;
            let emit_idx = alloc_checkpoint(state, cp_name);
            pending.push(emit_idx);

            if is_only {
                out.push(line.to_string());
                continue;
            }

            if is_skip_directive(line) {
                out.push(line.to_string());
                continue;
            }

            let anchor = alloc_anchor(state)?;
            for idx in &pending {
                state.emitted[*idx].anchor_name = anchor.clone();
            }
            out.push(synthetic_anchor_block(&anchor));
            pending.clear();
            out.push(line.to_string());
            continue;
        }

        if !pending.is_empty() && (is_comment_or_blank(line) || is_skip_directive(line)) {
            out.push(line.to_string());
            continue;
        }

        if !pending.is_empty() {
            let anchor = alloc_anchor(state)?;
            for idx in &pending {
                state.emitted[*idx].anchor_name = anchor.clone();
            }
            out.push(synthetic_anchor_block(&anchor));
            pending.clear();
            out.push(line.to_string());
            continue;
        }

        out.push(line.to_string());
    }

    if !pending.is_empty() {
        let names = pending
            .iter()
            .map(|idx| state.emitted[*idx].name.clone())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(FrameworkError::invalid_argument(format!(
            "checkpoint has no following instruction: {names}"
        )));
    }

    Ok(out.join(nl))
}

pub fn checkpoints_to_cdb(
    emitted: &[CheckpointEmit],
    defs: &HashMap<String, u32>,
) -> Result<String, FrameworkError> {
    if emitted.is_empty() {
        return Ok(String::new());
    }

    let mut lines = Vec::with_capacity(emitted.len());
    for cp in emitted {
        let byte_addr = defs
            .get(&cp.anchor_name.to_ascii_uppercase())
            .copied()
            .or_else(|| defs.get(&cp.anchor_name).copied())
            .ok_or_else(|| {
                FrameworkError::invalid_argument(format!(
                    "checkpoint anchor not in linker defs: {} ({})",
                    cp.anchor_name,
                    checkpoint_id(&cp.name, &cp.serial)
                ))
            })?;

        lines.push(format!(
            "L:{}:{:X}",
            checkpoint_id(&cp.name, &cp.serial),
            byte_addr
        ));
    }

    Ok(format!("{}\n", lines.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inject_trailing_cp_and_emit_cdb() {
        let src = "\t.cpu\tmn1613\nfoo:\n\tai\tR0, #1 ; @cp add_enter\n\th\n";
        let mut state = create_checkpoint_state();
        let injected = inject_checkpoints(src, &mut state).expect("inject should work");
        assert!(injected.contains("__CP0001:"));
        assert_eq!(state.emitted.len(), 1);
        assert_eq!(state.emitted[0].name, "add_enter");

        let mut defs = HashMap::new();
        defs.insert("__CP0001".to_string(), 0x1234);
        let cdb = checkpoints_to_cdb(&state.emitted, &defs).expect("cdb should work");
        assert!(cdb.contains("L:__CP$add_enter$0001:1234"));
    }

    #[test]
    fn inject_rejects_invalid_name() {
        let src = "\tai\tR0, #1 ; @cp 123bad\n";
        let mut state = create_checkpoint_state();
        let err = inject_checkpoints(src, &mut state).expect_err("invalid name should fail");
        assert!(format!("{err}").contains("invalid checkpoint name"));
    }
}
