//! 逆アセンブラ用ラベル表（CDB / 手動ペア）。
//!
//! TMS9995 はバイトアドレス。根拠: asm_test_framework.mdc

use std::collections::HashMap;

use crate::error::FrameworkError;
use crate::framework::tms9995::cdb::parse_tms9995_cdb;

/// バイトアドレスとラベル名のペア（初期化・手動登録用）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tms9995LabelPair {
    /// ラベル名
    pub name: String,
    /// バイトアドレス（16bit、偶数想定）
    pub byte_addr: u16,
}

#[derive(Debug, Clone)]
struct LabelEntry {
    name: String,
    scope: String,
}

/// バイトアドレス → ラベル名の対応を持つ。
#[derive(Debug, Default)]
pub struct Tms9995LabelTable {
    by_addr: HashMap<u16, LabelEntry>,
}

impl Tms9995LabelTable {
    /// CDB テキストからラベルを取り込む（`L:` の末尾はバイトアドレス）。
    pub fn load_cdb(&mut self, cdb_text: &str) -> Result<(), FrameworkError> {
        let table = parse_tms9995_cdb(cdb_text)?;
        for sym in &table.symbols {
            self.put((sym.byte_addr & 0xffff) as u16, &sym.name, &sym.scope);
        }
        Ok(())
    }

    /// ラベル:バイトアドレスの組を登録する（明示指定は既存を上書き）。
    pub fn set_labels(&mut self, entries: impl IntoIterator<Item = Tms9995LabelPair>) {
        for e in entries {
            let name = e.name.trim();
            if name.is_empty() {
                continue;
            }
            self.by_addr.insert(
                e.byte_addr & 0xffff,
                LabelEntry {
                    name: name.to_string(),
                    scope: "G".into(),
                },
            );
        }
    }

    /// 1 件追加する。同一アドレスに G があるとき F/L は無視。
    pub fn add_label(&mut self, name: &str, byte_addr: u16, scope: &str) {
        let n = name.trim();
        if n.is_empty() {
            return;
        }
        self.put(byte_addr & 0xffff, n, scope);
    }

    /// バイトアドレスに対応するラベル名を返す。
    pub fn lookup(&self, byte_addr: u16) -> Option<&str> {
        self.by_addr
            .get(&(byte_addr & 0xffff))
            .map(|e| e.name.as_str())
    }

    /// 登録件数（ユニークなアドレス数）。
    pub fn len(&self) -> usize {
        self.by_addr.len()
    }

    /// 登録が空か。
    pub fn is_empty(&self) -> bool {
        self.by_addr.is_empty()
    }

    fn put(&mut self, addr: u16, name: &str, scope: &str) {
        let prev = self.by_addr.get(&addr);
        if prev.is_none() || scope == "G" || prev.map(|p| p.scope.as_str()) != Some("G") {
            self.by_addr.insert(
                addr,
                LabelEntry {
                    name: name.to_string(),
                    scope: scope.to_string(),
                },
            );
        }
    }
}
