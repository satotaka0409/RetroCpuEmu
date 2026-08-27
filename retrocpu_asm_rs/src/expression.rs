use std::collections::HashMap;

use crate::error::AsmError;

fn parse_number(token: &str) -> Option<i32> {
    let t = token.trim();
    if let Some(hex) = t.strip_prefix('>') {
        if !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return i32::from_str_radix(hex, 16).ok();
        }
    }
    if t.len() > 2 && (&t[..2] == "0x" || &t[..2] == "0X") {
        return i32::from_str_radix(&t[2..], 16).ok();
    }
    if t.len() > 2 && (&t[..2] == "0o" || &t[..2] == "0O") {
        return i32::from_str_radix(&t[2..], 8).ok();
    }
    if t.len() > 2 && (&t[..2] == "0b" || &t[..2] == "0B") {
        return i32::from_str_radix(&t[2..], 2).ok();
    }
    if t.len() > 1 {
        let (body, suffix) = t.split_at(t.len() - 1);
        match suffix.to_ascii_uppercase().as_str() {
            "H" if body.chars().all(|c| c.is_ascii_hexdigit()) => {
                return i32::from_str_radix(body, 16).ok()
            }
            "O" | "Q" if body.chars().all(|c| ('0'..='7').contains(&c)) => {
                return i32::from_str_radix(body, 8).ok()
            }
            "B" if body.chars().all(|c| c == '0' || c == '1') => {
                return i32::from_str_radix(body, 2).ok()
            }
            "D" if body.chars().all(|c| c.is_ascii_digit()) => return body.parse::<i32>().ok(),
            _ => {}
        }
    }
    if t.chars().all(|c| c.is_ascii_digit()) {
        return t.parse::<i32>().ok();
    }
    None
}

fn subst_char_literals(expr: &str) -> Result<String, AsmError> {
    let chars: Vec<char> = expr.chars().collect();
    let mut out = String::new();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '\'' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        if i + 2 >= chars.len() || chars[i + 2] != '\'' {
            return Err(AsmError::new(format!("Invalid character literal: {expr}")));
        }
        let code = chars[i + 1] as u32;
        if code > 255 {
            return Err(AsmError::new(format!(
                "Character literal out of range: {expr}"
            )));
        }
        out.push_str(&format!("{}", code));
        i += 3;
    }
    Ok(out)
}

fn tokenize(expr: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let b = expr.as_bytes();
    while i < b.len() {
        let c = b[i] as char;
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if i + 1 < b.len() {
            let two = &expr[i..i + 2];
            if two == "<<" || two == ">>" {
                out.push(two.to_string());
                i += 2;
                continue;
            }
        }
        if "()+-*/%&|^~".contains(c) {
            out.push(c.to_string());
            i += 1;
            continue;
        }
        let start = i;
        while i < b.len() {
            let ch = b[i] as char;
            if ch.is_ascii_whitespace() || "()+-*/%&|^~".contains(ch) {
                break;
            }
            if i + 1 < b.len() {
                let two = &expr[i..i + 2];
                if two == "<<" || two == ">>" {
                    break;
                }
            }
            i += 1;
        }
        out.push(expr[start..i].to_string());
    }
    out
}

pub fn eval_expr(
    expr: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<i32, AsmError> {
    let rewritten = subst_char_literals(expr)?;
    let tokens = tokenize(&rewritten);
    if tokens.is_empty() {
        return Err(AsmError::new(format!("Empty expression: {expr}")));
    }
    let mut idx = 0usize;

    fn parse_primary(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        if *idx >= tokens.len() {
            return Err(AsmError::new(format!("Invalid expression: {source_expr}")));
        }
        let t = &tokens[*idx];
        *idx += 1;
        if t == "(" {
            let v = parse_or(tokens, idx, symbols, allow_undefined, source_expr)?;
            if *idx >= tokens.len() || tokens[*idx] != ")" {
                return Err(AsmError::new(format!(
                    "Missing ')' in expression: {source_expr}"
                )));
            }
            *idx += 1;
            return Ok(v);
        }
        if t == "+" {
            return parse_primary(tokens, idx, symbols, allow_undefined, source_expr);
        }
        if t == "-" {
            return Ok(-parse_primary(
                tokens,
                idx,
                symbols,
                allow_undefined,
                source_expr,
            )?);
        }
        if t == "~" {
            return Ok(
                (!parse_primary(tokens, idx, symbols, allow_undefined, source_expr)?) & 0xffff,
            );
        }
        if let Some(num) = parse_number(t) {
            return Ok(num);
        }
        let key = t.to_ascii_uppercase();
        match symbols.get(&key) {
            Some(v) => Ok(*v as i32),
            None if allow_undefined => Ok(0),
            None => Err(AsmError::new(format!("Undefined symbol: {t}"))),
        }
    }

    fn parse_mul(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        let mut v = parse_primary(tokens, idx, symbols, allow_undefined, source_expr)?;
        while *idx < tokens.len() {
            let op = tokens[*idx].as_str();
            if op != "*" && op != "/" && op != "%" {
                break;
            }
            *idx += 1;
            let r = parse_primary(tokens, idx, symbols, allow_undefined, source_expr)?;
            v = match op {
                "*" => v * r,
                "/" => {
                    if r == 0 {
                        return Err(AsmError::new(format!(
                            "Division by zero in expression: {source_expr}"
                        )));
                    }
                    v / r
                }
                _ => {
                    if r == 0 {
                        return Err(AsmError::new(format!(
                            "Modulo by zero in expression: {source_expr}"
                        )));
                    }
                    v % r
                }
            };
        }
        Ok(v)
    }

    fn parse_add(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        let mut v = parse_mul(tokens, idx, symbols, allow_undefined, source_expr)?;
        while *idx < tokens.len() {
            let op = tokens[*idx].as_str();
            if op != "+" && op != "-" {
                break;
            }
            *idx += 1;
            let r = parse_mul(tokens, idx, symbols, allow_undefined, source_expr)?;
            if op == "+" {
                v += r;
            } else {
                v -= r;
            }
        }
        Ok(v)
    }

    fn parse_shift(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        let mut v = parse_add(tokens, idx, symbols, allow_undefined, source_expr)?;
        while *idx < tokens.len() {
            let op = tokens[*idx].as_str();
            if op != "<<" && op != ">>" {
                break;
            }
            *idx += 1;
            let r = parse_add(tokens, idx, symbols, allow_undefined, source_expr)?;
            if op == "<<" {
                v = (v << r) & 0xffff;
            } else {
                v = ((v as u32) >> r) as i32 & 0xffff;
            }
        }
        Ok(v)
    }

    fn parse_and(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        let mut v = parse_shift(tokens, idx, symbols, allow_undefined, source_expr)?;
        while *idx < tokens.len() && tokens[*idx] == "&" {
            *idx += 1;
            v &= parse_shift(tokens, idx, symbols, allow_undefined, source_expr)?;
        }
        Ok(v)
    }

    fn parse_xor(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        let mut v = parse_and(tokens, idx, symbols, allow_undefined, source_expr)?;
        while *idx < tokens.len() && tokens[*idx] == "^" {
            *idx += 1;
            v ^= parse_and(tokens, idx, symbols, allow_undefined, source_expr)?;
        }
        Ok(v)
    }

    fn parse_or(
        tokens: &[String],
        idx: &mut usize,
        symbols: &HashMap<String, u16>,
        allow_undefined: bool,
        source_expr: &str,
    ) -> Result<i32, AsmError> {
        let mut v = parse_xor(tokens, idx, symbols, allow_undefined, source_expr)?;
        while *idx < tokens.len() && tokens[*idx] == "|" {
            *idx += 1;
            v |= parse_xor(tokens, idx, symbols, allow_undefined, source_expr)?;
        }
        Ok(v)
    }

    let result = parse_or(&tokens, &mut idx, symbols, allow_undefined, expr)?;
    if idx != tokens.len() {
        return Err(AsmError::new(format!(
            "Unexpected token in expression: {}",
            tokens[idx]
        )));
    }
    Ok(result)
}

pub fn ascii_codes_from_string_arg(arg: &str) -> Result<Option<Vec<u16>>, AsmError> {
    let t = arg.trim();
    if t.len() < 2 || !t.starts_with('"') || !t.ends_with('"') {
        return Ok(None);
    }
    let body = &t[1..t.len() - 1];
    if body.contains('"') {
        return Err(AsmError::new(format!("Invalid string literal: {arg}")));
    }
    let mut codes = Vec::new();
    for ch in body.chars() {
        let code = ch as u32;
        if code > 255 {
            return Err(AsmError::new(format!(
                "String character out of range: {arg}"
            )));
        }
        codes.push(code as u16);
    }
    Ok(Some(codes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eval_basic() {
        let mut symbols = HashMap::new();
        symbols.insert("A".to_string(), 3);
        assert_eq!(eval_expr("A + 5*2", &symbols, false).expect("eval"), 13);
    }

    #[test]
    fn string_arg_codes() {
        let c = ascii_codes_from_string_arg("\"AB\"")
            .expect("codes")
            .expect("is string");
        assert_eq!(c, vec![65, 66]);
    }
}
