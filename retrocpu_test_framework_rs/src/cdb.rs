//! SDCC CDB パーサ（MN1613 / TMS9995）。
//!
//! 根拠: `retrocpu_emu_ts/src/code_test/cdb.ts` / asm_test_framework.mdc

use std::collections::HashMap;

use regex::Regex;

use crate::checkpoint::checkpoint_id;
use crate::error::FrameworkError;
use crate::types::{CdbCheckpointInfo, CdbSymbolInfo};

/// CDB シンボル 1 件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CdbSymbol {
    pub name: String,
    pub byte_addr: u32,
    pub word_addr: u32,
    pub scope: String,
}

/// パース済み CDB 表。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CdbTable {
    pub by_name: HashMap<String, CdbSymbol>,
    pub symbols: Vec<CdbSymbol>,
    pub checkpoints: Vec<CdbCheckpointInfo>,
}

/// 空の CDB 表を作る。
pub fn empty_cdb_table() -> CdbTable {
    CdbTable::default()
}

fn cp_left_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})$").unwrap())
}

/// MN1613 向け CDB パース（奇数バイトアドレスはエラー）。
pub fn parse_cdb(cdb_text: &str) -> Result<CdbTable, FrameworkError> {
    let mut by_name = HashMap::new();
    let mut symbols = Vec::new();
    let mut checkpoints = Vec::new();

    for raw in cdb_text.replace("\r\n", "\n").lines() {
        let line = raw.trim();
        if line.len() < 3 || !line.starts_with("L:") {
            continue;
        }
        let body = &line[2..];
        let Some((left, addr_hex)) = body.rsplit_once(':') else {
            continue;
        };
        if !addr_hex.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        let byte_addr = u32::from_str_radix(addr_hex, 16)
            .map_err(|_| FrameworkError::invalid_argument(format!("bad CDB addr: {addr_hex}")))?;
        if byte_addr % 2 != 0 {
            return Err(FrameworkError::invalid_argument(format!(
                "CDB record \"{left}\" has odd byte address 0x{addr_hex} (MN1613 expects even)"
            )));
        }

        let cp_body = left
            .strip_prefix("G$__CP$")
            .or_else(|| left.strip_prefix("__CP$"));
        if let Some(cp_body) = cp_body {
            let caps = cp_left_re()
                .captures(cp_body)
                .ok_or_else(|| FrameworkError::invalid_argument(format!("Invalid checkpoint CDB record \"{left}\"")))?;
            let name = caps.get(1).unwrap().as_str().to_string();
            let serial = caps.get(2).unwrap().as_str().to_string();
            checkpoints.push(CdbCheckpointInfo {
                id: checkpoint_id(&name, &serial),
                name,
                serial,
                byte_addr,
                word_addr: byte_addr >> 1,
            });
            continue;
        }

        let parts: Vec<&str> = left.split('$').collect();
        if parts.len() < 2 || parts[1].is_empty() {
            continue;
        }
        let scope = parts[0].to_string();
        let name_part = parts[1].to_string();
        let sym = CdbSymbol {
            name: name_part.clone(),
            byte_addr,
            word_addr: byte_addr >> 1,
            scope: scope.clone(),
        };
        symbols.push(sym.clone());
        let prev = by_name.get(&name_part);
        if prev.is_none() || scope == "G" || prev.map(|p: &CdbSymbol| p.scope.as_str()) != Some("G") {
            by_name.insert(name_part, sym);
        }
    }

    Ok(CdbTable {
        by_name,
        symbols,
        checkpoints,
    })
}

/// シンボルを名前で引く（大文字小文字無視）。
pub fn require_symbol<'a>(table: &'a CdbTable, name: &str) -> Result<&'a CdbSymbol, FrameworkError> {
    let key = name.to_ascii_uppercase();
    if let Some(s) = table.by_name.get(&key) {
        return Ok(s);
    }
    for (n, s) in &table.by_name {
        if n.eq_ignore_ascii_case(name) {
            return Ok(s);
        }
    }
    Err(FrameworkError::invalid_argument(format!(
        "CDB symbol not found: {name}"
    )))
}

/// ワードアドレス → チェックポイント ID（複数は `,` 連結）。
pub fn checkpoint_ids_by_word_addr(table: &CdbTable) -> HashMap<u16, String> {
    let mut map = HashMap::new();
    for cp in &table.checkpoints {
        let addr = (cp.word_addr & 0xffff) as u16;
        map.entry(addr)
            .and_modify(|prev: &mut String| {
                prev.push(',');
                prev.push_str(&cp.id);
            })
            .or_insert(cp.id.clone());
    }
    map
}

impl From<&CdbSymbol> for CdbSymbolInfo {
    fn from(s: &CdbSymbol) -> Self {
        Self {
            name: s.name.clone(),
            byte_addr: s.byte_addr,
            word_addr: s.word_addr,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_global_and_checkpoint() {
        let cdb = "L:G$FOO$0$0:0200\nL:__CP$bar$0001:0204\n";
        let t = parse_cdb(cdb).expect("parse");
        assert_eq!(t.by_name.get("FOO").map(|s| s.word_addr), Some(0x100));
        assert_eq!(t.checkpoints.len(), 1);
        assert_eq!(t.checkpoints[0].name, "bar");
    }
}
