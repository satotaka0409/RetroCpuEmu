use crate::error::AsmError;
use crate::parser::strip_line_comment;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpuType {
    Mn1613,
    Tms9995,
}

pub fn parse_cpu_type(value: Option<&str>) -> Option<CpuType> {
    let v = value?.trim().to_ascii_lowercase();
    match v.as_str() {
        "mn1613" => Some(CpuType::Mn1613),
        "tms9995" => Some(CpuType::Tms9995),
        _ => None,
    }
}

pub fn scan_source_cpu(source_text: &str) -> Result<Option<CpuType>, AsmError> {
    let mut seen_content = false;
    let mut found: Option<CpuType> = None;

    for (idx, line) in source_text.replace("\r\n", "\n").split('\n').enumerate() {
        let body = strip_line_comment(line).trim().to_string();
        if body.is_empty() {
            continue;
        }

        let parts: Vec<&str> = body.split_whitespace().collect();
        if !parts.is_empty() && parts[0].eq_ignore_ascii_case(".cpu") {
            if seen_content {
                return Err(AsmError::new(format!(
                    "Line {}: .cpu must be the first non-comment line",
                    idx + 1
                )));
            }
            if found.is_some() {
                return Err(AsmError::new(format!(
                    "Line {}: duplicate .cpu directive",
                    idx + 1
                )));
            }
            if parts.len() < 2 {
                return Err(AsmError::new(format!(
                    "Line {}: .cpu requires mn1613 or tms9995",
                    idx + 1
                )));
            }
            let cpu = parse_cpu_type(Some(parts[1])).ok_or_else(|| {
                AsmError::new(format!(
                    "Line {}: unknown .cpu '{}' (mn1613 / tms9995)",
                    idx + 1,
                    parts[1]
                ))
            })?;
            found = Some(cpu);
            seen_content = true;
            continue;
        }

        seen_content = true;
    }

    Ok(found)
}

pub fn resolve_cpu_type(explicit: Option<CpuType>, source_text: &str) -> Result<CpuType, AsmError> {
    if let Some(cpu) = explicit {
        return Ok(cpu);
    }
    if let Some(cpu) = scan_source_cpu(source_text)? {
        return Ok(cpu);
    }
    Err(AsmError::new(
        "CPU が未指定です（--cpu / -m または先頭の .cpu で mn1613 / tms9995 を指定してください）",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_resolve_cpu() {
        let src = ";comment\n.cpu mn1613\nMAIN: h\n";
        assert_eq!(scan_source_cpu(src).expect("scan"), Some(CpuType::Mn1613));
        assert_eq!(
            resolve_cpu_type(None, src).expect("resolve"),
            CpuType::Mn1613
        );
    }
}
