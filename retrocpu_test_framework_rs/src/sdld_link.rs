//! sdld による .rel リンク（TS `sdldLink.ts` 相当）。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::FrameworkError;

const R3_BYTE: u8 = 0x01;
const R3_SYM: u8 = 0x02;

const SYS_PAGE0_WORD_BASE: u32 = 0x0008;
const USR_PAGE0_WORD_BASE: u32 = 0x0040;

fn sdld_area_bases() -> HashMap<&'static str, u32> {
    HashMap::from([
        ("_SYS_PAGE0", SYS_PAGE0_WORD_BASE * 2),
        ("_USR_PAGE0", USR_PAGE0_WORD_BASE * 2),
        ("_VECTOR", 0),
        ("_BIOS", 0),
        ("_CODE", 0),
    ])
}

/// sdld リンク結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SdldLinkResult {
    pub hex_text: String,
    pub cdb_text: String,
    pub map_text: String,
    pub image: Vec<u8>,
    pub defs: HashMap<String, u32>,
}

/// sdld 実行ファイルを探す。
pub fn find_sdld() -> Result<PathBuf, FrameworkError> {
    if let Ok(env_bin) = std::env::var("SDLD") {
        let p = PathBuf::from(env_bin.trim());
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Ok(dir) = std::env::var("SDCC_BIN_DIR") {
        let p = PathBuf::from(dir.trim()).join("sdld");
        if p.is_file() {
            return Ok(p);
        }
    }
    let home = std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("sdcc-mn1613/sdcc/build/sdcc/bin/sdld");
    if home.is_file() {
        return Ok(home);
    }
    let which = Command::new("which").arg("sdld").output();
    if let Ok(out) = which {
        if out.status.success() {
            let w = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !w.is_empty() {
                let p = PathBuf::from(w);
                if p.is_file() {
                    return Ok(p);
                }
            }
        }
    }
    Err(FrameworkError::invalid_argument(
        "sdld が見つかりません。`make sdcc-setup` するか SDCC_BIN_DIR / SDLD を設定してください",
    ))
}

fn decode_hex_line(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let hi = hex_nibble(bytes[i])?;
        let lo = hex_nibble(bytes[i + 1])?;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Some(out)
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn hex_checksum(bytes: &[u8]) -> u8 {
    let sum = bytes.iter().fold(0_u16, |acc, &b| (acc + b as u16) & 0xff);
    (!sum as u8).wrapping_add(1)
}

/// Intel HEX をパースする。
pub fn parse_intel_hex(text: &str) -> HashMap<u32, u8> {
    let mut out = HashMap::new();
    for raw in text.replace("\r\n", "\n").lines() {
        let line = raw.trim();
        if !line.starts_with(':') {
            continue;
        }
        let Some(bytes) = decode_hex_line(&line[1..]) else {
            continue;
        };
        if bytes.len() < 5 {
            continue;
        }
        let len = bytes[0] as usize;
        let addr = ((bytes[1] as u32) << 8) | (bytes[2] as u32);
        let typ = bytes[3];
        if typ != 0 {
            continue;
        }
        for i in 0..len {
            if 4 + i < bytes.len() {
                out.insert(addr + i as u32, bytes[4 + i]);
            }
        }
    }
    out
}

/// バイトマップを Intel HEX にする。
pub fn bytes_to_intel_hex(bytes: &HashMap<u32, u8>) -> String {
    let mut addrs: Vec<u32> = bytes.keys().copied().collect();
    addrs.sort_unstable();
    let mut lines = Vec::new();
    let mut i = 0;
    while i < addrs.len() {
        let start = addrs[i];
        let mut chunk = Vec::new();
        let mut a = start;
        while i < addrs.len() && addrs[i] == a && chunk.len() < 16 {
            chunk.push(*bytes.get(&a).unwrap_or(&0));
            i += 1;
            a += 1;
        }
        let mut rec = vec![
            chunk.len() as u8,
            ((start >> 8) & 0xff) as u8,
            (start & 0xff) as u8,
            0,
        ];
        rec.extend_from_slice(&chunk);
        rec.push(hex_checksum(&rec));
        lines.push(format!(
            ":{}",
            rec.iter()
                .map(|b| format!("{:02X}", b))
                .collect::<String>()
        ));
    }
    lines.push(":00000001FF".to_string());
    format!("{}\n", lines.join("\n"))
}

/// HEX バイトマップを密な配列にする。
pub fn hex_bytes_to_image(bytes: &HashMap<u32, u8>) -> Vec<u8> {
    let max = bytes.keys().copied().max();
    let Some(max) = max else {
        return Vec::new();
    };
    let mut img = vec![0_u8; (max + 1) as usize];
    for (a, b) in bytes {
        img[*a as usize] = *b;
    }
    img
}

/// sdld `.map` からシンボル値を読む。
pub fn parse_sdld_map_symbols(map_text: &str) -> HashMap<String, u32> {
    let re = regex::Regex::new(r"\b([0-9A-Fa-f]{4,8})\s+([A-Za-z_.][A-Za-z0-9_.$]*)\b").unwrap();
    let mut defs = HashMap::new();
    for line in map_text.replace("\r\n", "\n").lines() {
        if line.starts_with("Area") || line.starts_with('-') {
            continue;
        }
        for cap in re.captures_iter(line) {
            let name = cap.get(2).unwrap().as_str();
            if name == "Area" || name == "Addr" || name == "Size" {
                continue;
            }
            let val = u32::from_str_radix(cap.get(1).unwrap().as_str(), 16).unwrap_or(0);
            defs.insert(name.to_string(), val);
        }
    }
    defs
}

fn def_lookup(defs: &HashMap<String, u32>, name: &str) -> Option<u32> {
    if let Some(v) = defs.get(name) {
        return Some(*v);
    }
    let upper = name.to_ascii_uppercase();
    defs.iter()
        .find(|(k, _)| k.to_ascii_uppercase() == upper)
        .map(|(_, v)| *v)
}

/// リンカ Def を CDB テキストにする。
pub fn defs_to_cdb_from_sdld(defs: &HashMap<String, u32>) -> String {
    let mut names: Vec<&String> = defs.keys().collect();
    names.sort_by(|a, b| a.cmp(b));
    let cp_re = regex::Regex::new(r"^__CP\$([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})$").unwrap();
    let mut lines = Vec::new();
    for name in names {
        if regex::Regex::new(r"^__CP[0-9]{4}$")
            .unwrap()
            .is_match(name)
        {
            continue;
        }
        let val = defs.get(name.as_str()).copied().unwrap_or(0);
        let hex = format!("{:X}", val);
        if cp_re.is_match(name) {
            lines.push(format!("L:{name}:{hex}"));
        } else {
            lines.push(format!("L:G${name}$0$0:{hex}"));
        }
    }
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

/// `.lnk` 本文を組み立てる。
pub fn build_sdld_lnk(
    rel_paths: &[PathBuf],
    extra_b: &HashMap<String, u32>,
    out_name: &str,
    present_areas: Option<&HashSet<String>>,
) -> String {
    let bases = sdld_area_bases();
    let mut lines = vec![
        "-i".to_string(),
        "-m".to_string(),
        "-y".to_string(),
        "-w".to_string(),
        format!("-o {out_name}"),
    ];
    for (area, addr) in &bases {
        if let Some(present) = present_areas {
            if !present.contains(*area) {
                continue;
            }
        }
        if extra_b.contains_key(*area) {
            continue;
        }
        lines.push(format!("-b {area} = 0x{:X}", addr));
    }
    for (area, addr) in extra_b {
        if let Some(present) = present_areas {
            if !present.contains(area) {
                continue;
            }
        }
        lines.push(format!("-b {area} = 0x{addr:X}"));
    }
    for p in rel_paths {
        lines.push(p.display().to_string());
    }
    format!("{}\n", lines.join("\n"))
}

fn run_sdld_once(
    sdld: &Path,
    work_dir: &Path,
    out_name: &str,
    lnk_text: &str,
) -> Result<(), FrameworkError> {
    let lnk_path = work_dir.join(format!("{out_name}.lnk"));
    fs::write(&lnk_path, lnk_text).map_err(|e| {
        FrameworkError::invalid_argument(format!("failed to write {}: {e}", lnk_path.display()))
    })?;
    let output = Command::new(sdld)
        .arg("-f")
        .arg(&lnk_path)
        .current_dir(work_dir)
        .output()
        .map_err(|e| FrameworkError::invalid_argument(format!("sdld spawn failed: {e}")))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        return Err(FrameworkError::invalid_argument(format!(
            "sdld failed (exit {:?}): {}",
            output.status.code(),
            if !err.trim().is_empty() {
                err.trim().to_string()
            } else {
                out.trim().to_string()
            }
        )));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct RelocItem {
    mode: u8,
    rtp: u8,
    index: u16,
}

#[derive(Debug, Clone)]
struct RelChunk {
    area_name: String,
    t_addr: u32,
    data: Vec<u8>,
    items: Vec<RelocItem>,
}

#[derive(Debug, Clone)]
struct ParsedRel {
    areas: Vec<String>,
    area_sizes: HashMap<String, u32>,
    symbols: Vec<String>,
    chunks: Vec<RelChunk>,
}

fn parse_rel_chunks(text: &str) -> ParsedRel {
    let mut areas = Vec::new();
    let mut area_sizes = HashMap::new();
    let mut symbols = Vec::new();
    let mut chunks = Vec::new();
    let mut pending_t: Option<(u32, Vec<u8>)> = None;
    let mut current_area = "_CODE".to_string();
    for raw in text.replace("\r\n", "\n").lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        let tag = parts.first().copied().unwrap_or("");
        match tag {
            "A" => {
                current_area = parts.get(1).copied().unwrap_or("_CODE").to_string();
                areas.push(current_area.clone());
                let size_idx = parts.iter().position(|&p| p == "size");
                let size = size_idx
                    .and_then(|i| parts.get(i + 1))
                    .and_then(|s| u32::from_str_radix(s, 16).ok())
                    .unwrap_or(0);
                area_sizes.insert(current_area.clone(), size);
            }
            "S" => {
                symbols.push(parts.get(1).copied().unwrap_or("").to_string());
            }
            "T" => {
                let nums: Vec<u8> = parts
                    .iter()
                    .skip(1)
                    .filter_map(|p| u8::from_str_radix(p, 16).ok())
                    .collect();
                let t_addr = ((nums.first().copied().unwrap_or(0) as u32) << 8)
                    | (nums.get(1).copied().unwrap_or(0) as u32);
                pending_t = Some((t_addr, nums.into_iter().skip(2).collect()));
            }
            "R" => {
                if let Some((t_addr, data)) = pending_t.take() {
                    let nums: Vec<u8> = parts
                        .iter()
                        .skip(1)
                        .filter_map(|p| u8::from_str_radix(p, 16).ok())
                        .collect();
                    let area_idx =
                        ((nums.get(2).copied().unwrap_or(0) as u32) << 8) | nums.get(3).copied().unwrap_or(0) as u32;
                    let mut items = Vec::new();
                    let mut i = 4;
                    while i + 3 < nums.len() {
                        items.push(RelocItem {
                            mode: nums[i],
                            rtp: nums[i + 1],
                            index: ((nums[i + 2] as u16) << 8) | nums[i + 3] as u16,
                        });
                        i += 4;
                    }
                    let area_name = areas
                        .get(area_idx as usize)
                        .cloned()
                        .unwrap_or_else(|| current_area.clone());
                    chunks.push(RelChunk {
                        area_name,
                        t_addr,
                        data,
                        items,
                    });
                }
            }
            _ => {}
        }
    }
    ParsedRel {
        areas,
        area_sizes,
        symbols,
        chunks,
    }
}

fn seed_cursor(
    cursor: &mut HashMap<String, u32>,
    defs: &HashMap<String, u32>,
    bases_map: &HashMap<&'static str, u32>,
    area: &str,
    fallback: u32,
) {
    cursor.entry(area.to_string()).or_insert(
        def_lookup(defs, &format!("s_{area}"))
            .or_else(|| bases_map.get(area).copied())
            .unwrap_or(fallback),
    );
}

fn module_area_bases(
    rels: &[ParsedRel],
    defs: &HashMap<String, u32>,
) -> Vec<HashMap<String, u32>> {
    let bases_map = sdld_area_bases();
    let mut cursor = HashMap::new();
    seed_cursor(&mut cursor, defs, &bases_map, "_BIOS", 0);
    seed_cursor(&mut cursor, defs, &bases_map, "_CODE", 0);
    seed_cursor(
        &mut cursor,
        defs,
        &bases_map,
        "_DATA",
        def_lookup(defs, "s__CODE").unwrap_or(0),
    );
    seed_cursor(
        &mut cursor,
        defs,
        &bases_map,
        "_WORK",
        def_lookup(defs, "s__DATA").unwrap_or(0),
    );
    seed_cursor(
        &mut cursor,
        defs,
        &bases_map,
        "_SYS_PAGE0",
        bases_map.get("_SYS_PAGE0").copied().unwrap_or(0),
    );
    seed_cursor(
        &mut cursor,
        defs,
        &bases_map,
        "_USR_PAGE0",
        bases_map.get("_USR_PAGE0").copied().unwrap_or(0),
    );
    seed_cursor(&mut cursor, defs, &bases_map, "_VECTOR", 0);

    let mut out = Vec::new();
    for rel in rels {
        let mut this_base = HashMap::new();
        for area in &rel.areas {
            if !cursor.contains_key(area) {
                seed_cursor(&mut cursor, defs, &bases_map, area, 0);
            }
            this_base.insert(area.clone(), *cursor.get(area).unwrap_or(&0));
            if area != "_VECTOR" {
                let cur = cursor.get(area).copied().unwrap_or(0);
                let add = rel.area_sizes.get(area).copied().unwrap_or(0);
                cursor.insert(area.clone(), cur.wrapping_add(add));
            }
        }
        out.push(this_base);
    }
    out
}

fn read16be(bytes: &HashMap<u32, u8>, addr: u32) -> u16 {
    let hi = *bytes.get(&addr).unwrap_or(&0) as u16;
    let lo = *bytes.get(&(addr + 1)).unwrap_or(&0) as u16;
    (hi << 8) | lo
}

fn write16be(bytes: &mut HashMap<u32, u8>, addr: u32, val: u16) {
    bytes.insert(addr, ((val >> 8) & 0xff) as u8);
    bytes.insert(addr + 1, (val & 0xff) as u8);
}

fn apply_mn1613_word_addr_fixup(
    bytes: &mut HashMap<u32, u8>,
    rel_paths: &[PathBuf],
    defs: &HashMap<String, u32>,
) -> Result<(), FrameworkError> {
    let bases_map = sdld_area_bases();
    let parsed: Vec<ParsedRel> = rel_paths
        .iter()
        .map(|p| {
            let text = fs::read_to_string(p).map_err(|e| {
                FrameworkError::invalid_argument(format!("read rel {}: {e}", p.display()))
            })?;
            Ok(parse_rel_chunks(&text))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let bases = module_area_bases(&parsed, defs);
    for (rel_idx, parsed) in parsed.iter().enumerate() {
        let this_base = &bases[rel_idx];
        for chunk in &parsed.chunks {
            let area_base = this_base.get(&chunk.area_name).copied().unwrap_or(0);
            for item in &chunk.items {
                let field_off = chunk.t_addr + (item.rtp as u32).saturating_sub(2);
                let abs_addr = area_base.wrapping_add(field_off);
                if item.mode & R3_BYTE != 0 {
                    if item.mode & R3_SYM != 0 {
                        let sym_name = parsed.symbols.get(item.index as usize).cloned().unwrap_or_default();
                        let sym_val = def_lookup(defs, &sym_name).unwrap_or(0);
                        bytes.insert(abs_addr, ((sym_val >> 1) & 0xff) as u8);
                    } else {
                        let src_area = parsed
                            .areas
                            .get(item.index as usize)
                            .cloned()
                            .unwrap_or_else(|| chunk.area_name.clone());
                        let src_base = this_base
                            .get(&src_area)
                            .copied()
                            .or_else(|| def_lookup(defs, &format!("s_{src_area}")))
                            .or_else(|| bases_map.get(src_area.as_str()).copied())
                            .unwrap_or(0);
                        let orig = chunk.data.get(item.rtp as usize - 2).copied().unwrap_or(0);
                        bytes.insert(abs_addr, ((src_base + orig as u32) >> 1) as u8);
                    }
                } else {
                    let val = read16be(bytes, abs_addr);
                    write16be(bytes, abs_addr, (val >> 1) & 0xffff);
                }
            }
        }
    }
    Ok(())
}

fn apply_tms9995_byte_addr_fixup(
    bytes: &mut HashMap<u32, u8>,
    rel_paths: &[PathBuf],
    defs: &HashMap<String, u32>,
) -> Result<(), FrameworkError> {
    let bases_map = sdld_area_bases();
    let parsed: Vec<ParsedRel> = rel_paths
        .iter()
        .map(|p| {
            let text = fs::read_to_string(p).map_err(|e| {
                FrameworkError::invalid_argument(format!("read rel {}: {e}", p.display()))
            })?;
            Ok(parse_rel_chunks(&text))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let bases = module_area_bases(&parsed, defs);
    for (rel_idx, parsed) in parsed.iter().enumerate() {
        let this_base = &bases[rel_idx];
        for chunk in &parsed.chunks {
            if chunk.area_name != "_VECTOR" {
                continue;
            }
            let area_base = this_base.get(&chunk.area_name).copied().unwrap_or(0);
            for item in &chunk.items {
                let field_off = chunk.t_addr + (item.rtp as u32).saturating_sub(2);
                let abs_addr = area_base.wrapping_add(field_off);
                if item.mode & R3_BYTE != 0 {
                    if item.mode & R3_SYM != 0 {
                        let sym_name = parsed.symbols.get(item.index as usize).cloned().unwrap_or_default();
                        let sym_val = def_lookup(defs, &sym_name).unwrap_or(0);
                        bytes.insert(abs_addr, (sym_val & 0xff) as u8);
                    } else {
                        let src_area = parsed
                            .areas
                            .get(item.index as usize)
                            .cloned()
                            .unwrap_or_else(|| chunk.area_name.clone());
                        let src_base = this_base
                            .get(&src_area)
                            .copied()
                            .or_else(|| def_lookup(defs, &format!("s_{src_area}")))
                            .or_else(|| bases_map.get(src_area.as_str()).copied())
                            .unwrap_or(0);
                        let orig = chunk.data.get(item.rtp as usize - 2).copied().unwrap_or(0);
                        bytes.insert(abs_addr, ((src_base + orig as u32) & 0xff) as u8);
                    }
                } else {
                    let val = read16be(bytes, abs_addr);
                    write16be(bytes, abs_addr, (val << 1) & 0xffff);
                }
            }
        }
    }
    Ok(())
}

/// `.rel` を sdld でリンクする。
pub fn link_rels_with_sdld(
    rel_paths: &[PathBuf],
    word_addr_fixup: bool,
    work_dir: &Path,
    out_name: &str,
) -> Result<SdldLinkResult, FrameworkError> {
    if rel_paths.is_empty() {
        return Err(FrameworkError::invalid_argument(
            "link_rels_with_sdld: no .rel inputs",
        ));
    }
    let sdld = find_sdld()?;
    fs::create_dir_all(work_dir).map_err(|e| {
        FrameworkError::invalid_argument(format!("mkdir {}: {e}", work_dir.display()))
    })?;

    let abs_rels: Vec<PathBuf> = rel_paths
        .iter()
        .map(|p| p.canonicalize().unwrap_or_else(|_| p.clone()))
        .collect();
    let mut present_areas = HashSet::new();
    for p in &abs_rels {
        if let Ok(text) = fs::read_to_string(p) {
            for line in text.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.first() == Some(&"A") {
                    if let Some(area) = parts.get(1) {
                        present_areas.insert((*area).to_string());
                    }
                }
            }
        }
    }

    run_sdld_once(
        &sdld,
        work_dir,
        out_name,
        &build_sdld_lnk(&abs_rels, &HashMap::new(), out_name, Some(&present_areas)),
    )?;

    let map_path = work_dir.join(format!("{out_name}.map"));
    let mut map_text = fs::read_to_string(&map_path).unwrap_or_default();
    let mut defs = parse_sdld_map_symbols(&map_text);

    let mut extra_b = HashMap::new();
    let code_len = def_lookup(&defs, "l__CODE")
        .or_else(|| def_lookup(&defs, "l_CODE"))
        .unwrap_or(0);
    let mut code_start = def_lookup(&defs, "s__CODE")
        .or_else(|| def_lookup(&defs, "s_CODE"))
        .unwrap_or(0);
    if present_areas.contains("_BIOS") && present_areas.contains("_CODE") {
        let bios_start = def_lookup(&defs, "s__BIOS")
            .or_else(|| def_lookup(&defs, "s_BIOS"))
            .unwrap_or(0);
        let bios_len = def_lookup(&defs, "l__BIOS")
            .or_else(|| def_lookup(&defs, "l_BIOS"))
            .unwrap_or(0);
        extra_b.insert("_CODE".to_string(), bios_start.wrapping_add(bios_len));
        code_start = extra_b["_CODE"];
    }
    if present_areas.contains("_DATA") {
        extra_b.insert("_DATA".to_string(), code_start.wrapping_add(code_len));
    }
    let data_len = def_lookup(&defs, "l__DATA")
        .or_else(|| def_lookup(&defs, "l_DATA"))
        .unwrap_or(0);
    let data_start = extra_b
        .get("_DATA")
        .copied()
        .or_else(|| def_lookup(&defs, "s__DATA"))
        .or_else(|| def_lookup(&defs, "s_DATA"));
    if present_areas.contains("_WORK") {
        if let Some(ds) = data_start {
            extra_b.insert("_WORK".to_string(), ds.wrapping_add(data_len));
        } else {
            extra_b.insert("_WORK".to_string(), code_start.wrapping_add(code_len));
        }
    }
    if !extra_b.is_empty() {
        run_sdld_once(
            &sdld,
            work_dir,
            out_name,
            &build_sdld_lnk(&abs_rels, &extra_b, out_name, Some(&present_areas)),
        )?;
        map_text = fs::read_to_string(&map_path).unwrap_or_default();
        defs = parse_sdld_map_symbols(&map_text);
    }

    let raw_ihx = work_dir.join(format!("{out_name}.ihx"));
    if !raw_ihx.is_file() {
        return Err(FrameworkError::invalid_argument(format!(
            "sdld did not write {}",
            raw_ihx.display()
        )));
    }
    let raw_hex = fs::read_to_string(&raw_ihx).map_err(|e| {
        FrameworkError::invalid_argument(format!("read ihx {}: {e}", raw_ihx.display()))
    })?;
    let mut bytes = parse_intel_hex(&raw_hex);
    if word_addr_fixup {
        apply_mn1613_word_addr_fixup(&mut bytes, &abs_rels, &defs)?;
    } else {
        apply_tms9995_byte_addr_fixup(&mut bytes, &abs_rels, &defs)?;
    }
    let hex_text = bytes_to_intel_hex(&bytes);
    let cdb_text = defs_to_cdb_from_sdld(&defs);
    let image = hex_bytes_to_image(&bytes);
    Ok(SdldLinkResult {
        hex_text,
        cdb_text,
        map_text,
        image,
        defs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_intel_hex_roundtrip() {
        let text = ":020000040002F8\n:04000000AABBCCDDEE\n:00000001FF\n";
        let m = parse_intel_hex(text);
        assert_eq!(m.get(&0), Some(&0xAA));
        assert_eq!(m.get(&1), Some(&0xBB));
    }

    #[test]
    fn defs_to_cdb_from_sdld_formats_globals() {
        let mut defs = HashMap::new();
        defs.insert("GL_TEST".to_string(), 0x0200);
        let cdb = defs_to_cdb_from_sdld(&defs);
        assert!(cdb.contains("L:G$GL_TEST$0$0:200"));
    }
}
