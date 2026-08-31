//! sdas / sdld 互換 XH2 REL 出力（TS `relWriter.ts` 相当）。

use std::collections::HashMap;

use crate::area_order::{asxxxx_area_flags, canonical_area_name, order_link_area_names};
use crate::types::{
    AddressUnit, AssemblyResult, EmittedWord, RelocOperand, RelocWidth, SymbolKind,
    WordDiffReloc,
};

const MAX_T_DATA_BYTES: usize = 14;

const R3_WORD_AREA: u8 = 0x00;
const R3_WORD_SYM: u8 = 0x02;
const R3_BYTE_AREA: u8 = 0x01;
const R3_BYTE_SYM: u8 = 0x03;

struct GlobalEntry {
    name: String,
    def: bool,
    value: u16,
    area: Option<String>,
}

fn hex2(v: u8) -> String {
    format!("{:02X}", v)
}

fn hex4(v: u16) -> String {
    format!("{:04X}", v)
}

fn be_word(v: u16) -> String {
    format!("{} {}", hex2((v >> 8) as u8), hex2(v as u8))
}

fn sdld_sym_name(name: &str) -> String {
    if name.len() >= 3 && (name.starts_with("S__") || name.starts_with("L__")) {
        let mut chars: Vec<char> = name.chars().collect();
        chars[0] = chars[0].to_ascii_lowercase();
        chars.into_iter().collect()
    } else {
        name.to_string()
    }
}

fn units_to_rel_addr(units: u16, byte_addrs: bool) -> u16 {
    if byte_addrs {
        units
    } else {
        units.wrapping_mul(2)
    }
}

fn area_size_rel(size_units: u16, byte_addrs: bool) -> u16 {
    if byte_addrs {
        size_units
    } else {
        size_units.wrapping_mul(2)
    }
}

fn reloc_item(
    r: &WordDiffReloc,
    rtp: u8,
    area_index_by_name: &HashMap<String, usize>,
    sym_index_by_name: &HashMap<String, usize>,
) -> Option<(u8, u8, u16)> {
    if !matches!(r.right, RelocOperand::Const { value: 0 }) {
        return None;
    }
    let low8 = matches!(r.width, Some(RelocWidth::Low8));
    match &r.left {
        RelocOperand::Symbol { name } => {
            let idx = *sym_index_by_name.get(name)?;
            Some((
                if low8 { R3_BYTE_SYM } else { R3_WORD_SYM },
                rtp,
                idx as u16,
            ))
        }
        RelocOperand::Word { area, .. } => {
            let area_name = canonical_area_name(area.as_deref().unwrap_or("_CODE"));
            let idx = *area_index_by_name.get(&area_name)?;
            Some((
                if low8 { R3_BYTE_AREA } else { R3_WORD_AREA },
                rtp,
                idx as u16,
            ))
        }
        RelocOperand::Const { .. } => None,
    }
}

/// REL テキストを生成する（sdld XH2）。
pub fn write_rel(result: &AssemblyResult, module_name: &str) -> String {
    let byte_addrs = result.address_unit == AddressUnit::Byte;
    let addr_step = if byte_addrs { 2_u16 } else { 1_u16 };

    let mut global_entries: Vec<GlobalEntry> = Vec::new();
    for (name, info) in &result.symbol_infos {
        match info.kind {
            SymbolKind::Global => global_entries.push(GlobalEntry {
                name: name.clone(),
                def: true,
                value: info.value,
                area: info.area.clone(),
            }),
            SymbolKind::External => global_entries.push(GlobalEntry {
                name: name.clone(),
                def: false,
                value: 0,
                area: None,
            }),
            SymbolKind::Local => {}
        }
    }
    global_entries.sort_by(|a, b| a.name.cmp(&b.name));

    let area_names = order_link_area_names(std::iter::once("_CODE").chain(
        global_entries
            .iter()
            .filter_map(|g| g.area.as_deref()),
    ));
    if area_names.is_empty() {
        return "XH2\nE\n".to_string();
    }

    let area_index_by_name: HashMap<String, usize> = area_names
        .iter()
        .enumerate()
        .map(|(i, n)| (n.clone(), i))
        .collect();

    let abs_name = ".__.ABS.";
    let mut sym_index_by_name: HashMap<String, usize> = HashMap::new();
    let mut sym_n = 0_usize;
    sym_index_by_name.insert(abs_name.to_string(), sym_n);
    sym_n += 1;
    for g in global_entries.iter().filter(|g| !g.def) {
        sym_index_by_name.insert(g.name.clone(), sym_n);
        sym_n += 1;
    }
    for area_name in &area_names {
        for g in global_entries.iter().filter(|g| g.def) {
            if canonical_area_name(g.area.as_deref().unwrap_or("_CODE")) != *area_name {
                continue;
            }
            sym_index_by_name.insert(g.name.clone(), sym_n);
            sym_n += 1;
        }
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push("XH2".to_string());
    lines.push(format!(
        "H {:X} areas {:X} global symbols",
        area_names.len(),
        sym_n
    ));
    lines.push(format!("M {module_name}"));
    lines.push(format!("S {abs_name} Def0000"));
    for g in global_entries.iter().filter(|g| !g.def) {
        lines.push(format!("S {} Ref0000", sdld_sym_name(&g.name)));
    }

    for area_name in &area_names {
        let mut sorted: Vec<&EmittedWord> = if area_name == "_CODE" {
            result.words.iter().collect()
        } else {
            Vec::new()
        };
        sorted.sort_by_key(|w| w.address);
        let max_addr = sorted.iter().map(|w| w.address).max();
        let from_words = match max_addr {
            None => 0,
            Some(m) if byte_addrs => m.wrapping_add(2),
            Some(m) => m.wrapping_add(1),
        };
        let size_rel = area_size_rel(from_words, byte_addrs);
        let noload = area_name == "_WORK";
        let flags = asxxxx_area_flags(area_name, noload);
        lines.push(format!(
            "A {area_name} size {} flags {} addr 0",
            hex4(size_rel),
            hex4(flags)
        ));

        for g in global_entries.iter().filter(|g| g.def) {
            if canonical_area_name(g.area.as_deref().unwrap_or("_CODE")) != *area_name {
                continue;
            }
            let def_rel = units_to_rel_addr(g.value, byte_addrs);
            lines.push(format!(
                "S {} Def{}",
                sdld_sym_name(&g.name),
                hex4(def_rel)
            ));
        }

        let area_idx = area_index_by_name.get(area_name).copied().unwrap_or(0);
        let area_relocs: Vec<_> = result
            .relocs
            .iter()
            .filter(|r| canonical_area_name(r.area.as_deref().unwrap_or("_CODE")) == *area_name)
            .collect();

        let mut idx = 0_usize;
        while idx < sorted.len() {
            let run_start = idx;
            let mut run_end = idx;
            while run_end + 1 < sorted.len()
                && sorted[run_end + 1].address == sorted[run_end].address.wrapping_add(addr_step)
            {
                run_end += 1;
            }

            let mut p = run_start;
            while p <= run_end {
                let max_words = MAX_T_DATA_BYTES / 2;
                let chunk_words = std::cmp::min(max_words, run_end - p + 1);
                let first_addr = sorted[p].address;
                let rel_addr = units_to_rel_addr(first_addr, byte_addrs);
                let mut bytes: Vec<u8> = Vec::new();
                for i in 0..chunk_words {
                    let w = sorted[p + i].value & 0xffff;
                    bytes.push((w >> 8) as u8);
                    bytes.push(w as u8);
                }
                let start_byte = if byte_addrs {
                    first_addr
                } else {
                    first_addr.wrapping_mul(2)
                };
                let end_byte = start_byte.wrapping_add(bytes.len() as u16);
                lines.push(format!(
                    "T {} {}",
                    be_word(rel_addr),
                    bytes.iter().map(|b| hex2(*b)).collect::<Vec<_>>().join(" ")
                ));

                let mut items: Vec<String> = Vec::new();
                for r in &area_relocs {
                    if r.byte_addr < start_byte || r.byte_addr >= end_byte {
                        continue;
                    }
                    let rtp = 2 + (r.byte_addr - start_byte) as u8;
                    let item = reloc_item(r, rtp, &area_index_by_name, &sym_index_by_name)
                        .unwrap_or_else(|| {
                            panic!(
                                "unsupported reloc at {} in {area_name} (sdld needs a single absolute symbol or area)",
                                hex4(r.byte_addr)
                            )
                        });
                    items.push(format!(
                        "{} {} {}",
                        hex2(item.0),
                        hex2(item.1),
                        be_word(item.2)
                    ));
                }
                lines.push(format!(
                    "R {} {}{}",
                    be_word(R3_WORD_AREA as u16),
                    be_word(area_idx as u16),
                    if items.is_empty() {
                        String::new()
                    } else {
                        format!(" {}", items.join(" "))
                    }
                ));
                p += chunk_words;
            }

            idx = run_end + 1;
        }
    }

    lines.push("E".to_string());
    format!("{}\n", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use crate::cpu_type::CpuType;
    use crate::types::{EmittedWord, SourceLine, SymbolInfo, SymbolKind};

    #[test]
    fn xh2_rel_contains_def_global() {
        let result = AssemblyResult {
            words: vec![EmittedWord {
                address: 0x0200,
                value: 0x5809,
                line_no: 1,
                source: String::new(),
            }],
            symbols: [("GL_ADD".to_string(), 0x0200)].into(),
            source_lines: vec![SourceLine {
                line_no: 1,
                text: String::new(),
            }],
            cpu_type: CpuType::Mn1613,
            address_unit: AddressUnit::Word,
            storage_addrs: HashMap::new(),
            symbol_infos: [(
                "GL_ADD".to_string(),
                SymbolInfo {
                    value: 0x0200,
                    kind: SymbolKind::Global,
                    area: Some("_CODE".to_string()),
                },
            )]
            .into(),
            relocs: Vec::new(),
        };
        let rel = write_rel(&result, "MAIN");
        assert!(rel.starts_with("XH2\n"));
        assert!(rel.contains("S GL_ADD Def"));
        assert!(rel.contains("58 09"));
        assert!(rel.contains("T 04 00"));
    }
}
