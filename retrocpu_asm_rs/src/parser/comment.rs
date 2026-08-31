//! 行末コメント除去（`;` / `//`。引用符内は残す）。

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_comments_with_quotes() {
        assert_eq!(strip_line_comment(".dw \"A;B\" ; c"), ".dw \"A;B\" ");
    }
}
