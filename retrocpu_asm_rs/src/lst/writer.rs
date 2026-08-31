//! sdas 風 LST（リスト）出力。
//!
//! **MN1613**: アドレス列は **ワードアドレス**（`AssemblyResult.words[].address` をそのまま）。
//! **TMS9995**: バイトアドレス。REL 出力は [`write_rel`](crate::rel::write_rel) が MN1613 のみ×2 する。
//!
//! 書式は `retrocpu_asm_ts/src/main/lstWriter.ts` と同一（10 桁インデント、続行末尾スペース）。

use std::collections::HashMap;

use crate::types::AssemblyResult;

/// 16bit 値を 4 桁大文字 16 進にする。
fn hex4(v: u16) -> String {
    format!("{:04X}", v & 0xffff)
}

/// `AssemblyResult` から LST テキストを生成する。
pub fn write_lst(result: &AssemblyResult) -> String {
    let mut by_line: HashMap<usize, Vec<(u16, u16)>> = HashMap::new();
    for w in &result.words {
        by_line
            .entry(w.line_no)
            .or_default()
            .push((w.address, w.value));
    }

    let mut out: Vec<String> = Vec::new();
    for s in &result.source_lines {
        if let Some(vs) = by_line.get(&s.line_no) {
            for (idx, (addr, val)) in vs.iter().enumerate() {
                let prefix = format!("{} {} ", hex4(*addr), hex4(*val));
                if idx == 0 {
                    out.push(format!("{} {}", prefix, s.text));
                } else {
                    out.push(prefix);
                }
            }
        } else if let Some(loc) = result.storage_addrs.get(&s.line_no) {
            // 命令行は `AAAA VVVV  text`（11 桁）。ストレージ行はアドレス列のみ。
            out.push(format!("{}       {}", hex4(*loc), s.text));
        } else {
            out.push(format!("          {}", s.text));
        }
    }
    format!("{}\n", out.join("\n"))
}
