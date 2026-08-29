use std::collections::HashMap;

use crate::error::FrameworkError;

use super::types::{CdbCheckpoint, CdbSymbol, CdbTable};

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn empty_tms9995_cdb_table() -> CdbTable {
    CdbTable {
        by_name: HashMap::new(),
        symbols: Vec::new(),
        checkpoints: Vec::new(),
    }
}

pub fn parse_tms9995_cdb(cdb_text: &str) -> Result<CdbTable, FrameworkError> {
    let mut table = empty_tms9995_cdb_table();

    for raw in cdb_text.replace("\r\n", "\n").split('\n') {
        let line = raw.trim();
        if line.len() < 3 {
            continue;
        }
        if !line.starts_with("L:") {
            continue;
        }

        let body = &line[2..];
        let Some(colon) = body.rfind(':') else {
            continue;
        };
        let left = &body[..colon];
        let addr_hex = body[colon + 1..].trim();
        if !is_hex(addr_hex) {
            continue;
        }

        let byte_addr = u32::from_str_radix(addr_hex, 16).map_err(|_| {
            FrameworkError::invalid_argument(format!("invalid CDB address: {addr_hex}"))
        })?;

        let cp_left = left.strip_prefix("G$").unwrap_or(left);
        if let Some(rest) = cp_left.strip_prefix("__CP$") {
            let mut parts = rest.split('$');
            let Some(name) = parts.next() else {
                return Err(FrameworkError::invalid_argument(format!(
                    "invalid checkpoint CDB record \"{left}\""
                )));
            };
            let Some(serial) = parts.next() else {
                return Err(FrameworkError::invalid_argument(format!(
                    "invalid checkpoint CDB record \"{left}\""
                )));
            };
            if parts.next().is_some()
                || name.is_empty()
                || !name
                    .bytes()
                    .all(|b| b == b'_' || b.is_ascii_alphanumeric())
                || !name
                    .bytes()
                    .next()
                    .map(|b| b == b'_' || b.is_ascii_alphabetic())
                    .unwrap_or(false)
                || serial.len() != 4
                || !serial.bytes().all(|b| b.is_ascii_digit())
            {
                return Err(FrameworkError::invalid_argument(format!(
                    "invalid checkpoint CDB record \"{left}\""
                )));
            }

            table.checkpoints.push(CdbCheckpoint {
                id: format!("__CP${name}${serial}"),
                name: name.to_string(),
                serial: serial.to_string(),
                byte_addr,
                word_addr: byte_addr >> 1,
            });
            continue;
        }

        let mut parts = left.split('$');
        let Some(scope) = parts.next() else {
            continue;
        };
        let Some(name_part) = parts.next() else {
            continue;
        };
        if name_part.is_empty() {
            continue;
        }

        let sym = CdbSymbol {
            name: name_part.to_string(),
            byte_addr,
            word_addr: byte_addr >> 1,
            scope: scope.to_string(),
        };
        table.symbols.push(sym.clone());

        let prev = table.by_name.get(name_part);
        if prev.is_none() || scope == "G" || prev.map(|p| p.scope.as_str()) != Some("G") {
            table.by_name.insert(name_part.to_string(), sym);
        }
    }

    Ok(table)
}

pub fn require_tms9995_symbol(table: &CdbTable, name: &str) -> Result<CdbSymbol, FrameworkError> {
    if let Some(sym) = table.by_name.get(name) {
        return Ok(sym.clone());
    }

    let upper = name.to_ascii_uppercase();
    for (k, v) in &table.by_name {
        if k.to_ascii_uppercase() == upper {
            return Ok(v.clone());
        }
    }

    Err(FrameworkError::invalid_argument(format!(
        "CDB symbol not found: {name}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_accepts_odd_byte_address() {
        let t = parse_tms9995_cdb("L:G$ODD$0$0:0001\n").expect("parse should work");
        assert_eq!(t.by_name.get("ODD").map(|s| s.byte_addr), Some(1));
    }

    #[test]
    fn parse_checkpoint_record() {
        let t = parse_tms9995_cdb("L:G$__CP$enter$0001:0101\n").expect("parse should work");
        assert_eq!(t.checkpoints.len(), 1);
        assert_eq!(t.checkpoints[0].id, "__CP$enter$0001");
        assert_eq!(t.checkpoints[0].byte_addr, 0x0101);
    }
}
