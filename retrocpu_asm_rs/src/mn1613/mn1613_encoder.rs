//! MN1613 命令エンコード（16bit 語、最大 2 語／行）。
//!
//! sdas 互換のオペランド表記（`#` 即値、間接 `(Rn)`、スキップ条件等）を
//! 機械語へ変換する。根拠: `.cursor/rules` の MN1610/MN1613 命令仕様。

use std::collections::HashMap;

use crate::error::AsmError;
use crate::expression::eval_expr;
use crate::types::ParsedLine;

fn reg_map() -> HashMap<&'static str, u16> {
    HashMap::from([
        ("R0", 0),
        ("R1", 1),
        ("R2", 2),
        ("R3", 3),
        ("X0", 3),
        ("R4", 4),
        ("X1", 4),
        ("SP", 5),
        ("STR", 6),
    ])
}

fn require_dr0(arg: &str) -> Result<(), AsmError> {
    if !arg.trim().eq_ignore_ascii_case("DR0") {
        return Err(AsmError::new(format!(
            "First operand must be DR0 (got '{}')",
            arg
        )));
    }
    Ok(())
}

fn parse_dr0_mem_ri(arg: &str) -> Result<u16, AsmError> {
    let indir = parse_indirect(arg)?;
    if indir.mm != 0b01 {
        return Err(AsmError::new(format!(
            "Second operand must be (R1)-(R4) (got '{}')",
            arg
        )));
    }
    Ok(indir.ii)
}
fn skip_map() -> HashMap<&'static str, u16> {
    HashMap::from([
        ("", 0),
        ("SKP", 1),
        ("M", 2),
        ("PZ", 3),
        ("Z", 4),
        ("E", 4),
        ("NZ", 5),
        ("NE", 5),
        ("MZ", 6),
        ("P", 7),
        ("EZ", 8),
        ("ENZ", 9),
        ("OZ", 10),
        ("ONZ", 11),
        ("LMZ", 12),
        ("LP", 13),
        ("LPZ", 14),
        ("LM", 15),
    ])
}

fn em_map() -> HashMap<&'static str, u16> {
    HashMap::from([("", 0), ("RE", 1), ("SE", 2), ("CE", 3)])
}

fn bb_map() -> HashMap<&'static str, u16> {
    HashMap::from([("CSBR", 0), ("SSBR", 1), ("TSR0", 2), ("TSR1", 3)])
}

fn bbb_map() -> HashMap<&'static str, u16> {
    HashMap::from([
        ("CSBR", 0),
        ("SSBR", 1),
        ("TSR0", 2),
        ("TSR1", 3),
        ("OSR0", 4),
        ("OSR1", 5),
        ("OSR2", 6),
        ("OSR3", 7),
    ])
}

fn ppp_map() -> HashMap<&'static str, u16> {
    HashMap::from([("SBRB", 0), ("ICB", 1), ("NPP", 2)])
}

fn hhh_map() -> HashMap<&'static str, u16> {
    HashMap::from([
        ("TCR", 0),
        ("TIR", 1),
        ("TSR", 2),
        ("SCR", 3),
        ("SSR", 4),
        ("SOR", 5),
        ("IISR", 6),
    ])
}

fn ii_map() -> HashMap<&'static str, u16> {
    HashMap::from([("R1", 0), ("R2", 1), ("R3", 2), ("R4", 3)])
}

fn u8v(v: i32, what: &str) -> Result<u16, AsmError> {
    if !(0..=0xff).contains(&v) {
        return Err(AsmError::new(format!("{what} out of 8-bit range: {v}")));
    }
    Ok((v & 0xff) as u16)
}

fn u4(v: i32, what: &str) -> Result<u16, AsmError> {
    if !(0..=0x0f).contains(&v) {
        return Err(AsmError::new(format!("{what} out of 4-bit range: {v}")));
    }
    Ok((v & 0x0f) as u16)
}

fn u2(v: i32, what: &str) -> Result<u16, AsmError> {
    if !(0..=0x03).contains(&v) {
        return Err(AsmError::new(format!("{what} out of 2-bit range: {v}")));
    }
    Ok((v & 0x03) as u16)
}

fn s8(v: i32, what: &str) -> Result<u16, AsmError> {
    if !(-128..=127).contains(&v) {
        return Err(AsmError::new(format!(
            "{what} out of signed 8-bit range: {v}"
        )));
    }
    Ok((v & 0xff) as u16)
}

/// 式評価結果を 16bit 即値へクリップ（範囲外はエラー）。
pub fn u16(v: i32, what: &str) -> Result<u16, AsmError> {
    if !(-0x8000..=0xffff).contains(&v) {
        return Err(AsmError::new(format!("{what} out of 16-bit range: {v}")));
    }
    Ok((v & 0xffff) as u16)
}

/// 第 2 語に 16bit 即値／アドレスを取る命令か（PC 加算・サイズ計算用）。
pub fn is_two_word_op(op: &str) -> bool {
    matches!(
        op.to_ascii_uppercase().as_str(),
        "LD" | "STD"
            | "BD"
            | "BL"
            | "BALD"
            | "BALL"
            | "TSET"
            | "TRST"
            | "LB"
            | "LS"
            | "STB"
            | "STS"
            | "MVWI"
            | "AWI"
            | "SWI"
            | "CWI"
            | "CBI"
            | "ANDI"
            | "ORI"
            | "EORI"
            | "LADI"
    )
}

fn parse_reg(token: &str, allow_str: bool) -> Result<u16, AsmError> {
    let key = token.trim().to_ascii_uppercase();
    let reg = reg_map()
        .get(key.as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown register: {token}")))?;
    if !allow_str && reg == 6 {
        return Err(AsmError::new(format!("STR is not allowed here: {token}")));
    }
    Ok(reg)
}

fn parse_skip(token: Option<&str>) -> Result<u16, AsmError> {
    let key = token.unwrap_or("").trim().to_ascii_uppercase();
    skip_map()
        .get(key.as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown skip condition: {}", token.unwrap_or(""))))
}

fn parse_em(token: Option<&str>) -> Result<u16, AsmError> {
    let key = token.unwrap_or("").trim().to_ascii_uppercase();
    em_map()
        .get(key.as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown EM operation: {}", token.unwrap_or(""))))
}

fn require_imm_hash(arg: &str, what: &str) -> Result<String, AsmError> {
    let t = arg.trim();
    if !t.starts_with('#') {
        return Err(AsmError::new(format!(
            "{what}: immediate operand requires '#' (got '{arg}')"
        )));
    }
    Ok(t[1..].trim().to_string())
}

fn forbid_imm_hash(arg: &str, what: &str) -> Result<String, AsmError> {
    let t = arg.trim();
    if t.starts_with('#') {
        return Err(AsmError::new(format!(
            "{what} must not use '#' (got '{arg}')"
        )));
    }
    Ok(t.to_string())
}

fn parse_imm4(
    arg: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<u16, AsmError> {
    u4(
        eval_expr(&require_imm_hash(arg, "I4")?, symbols, allow_undefined)?,
        "I4",
    )
}

/// `AI` / `SI` で `#imm` が 4bit を超えるとき、複数語へ分割した語列を返す。
///
/// 対象外（別オペランド形式）なら `Ok(None)`。
pub fn split_ai_si_imm4_chunks(
    line: &ParsedLine,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<Option<Vec<u16>>, AsmError> {
    let Some(op) = line.op.as_ref() else {
        return Ok(None);
    };
    let op = op.to_ascii_uppercase();
    if op != "AI" && op != "SI" {
        return Ok(None);
    }
    if line.args.len() != 2 {
        return Ok(None);
    }
    let imm = eval_expr(
        &require_imm_hash(&line.args[1], "I4")?,
        symbols,
        allow_undefined,
    )?;
    if imm < 0 {
        return Err(AsmError::new(format!("I4 out of 4-bit range: {imm}")));
    }
    if imm <= 0x0f {
        return Ok(Some(vec![imm as u16]));
    }
    let mut out = Vec::new();
    let mut remain = imm;
    while remain > 0 {
        let step = remain.min(0x0f);
        out.push(step as u16);
        remain -= step;
    }
    Ok(Some(out))
}

fn parse_imm8(
    arg: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<u16, AsmError> {
    u8v(
        eval_expr(&require_imm_hash(arg, "I8")?, symbols, allow_undefined)?,
        "I8",
    )
}

fn parse_io_addr8(
    arg: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<u16, AsmError> {
    let t = arg.trim();
    let s = if let Some(rest) = t.strip_prefix('#') {
        rest
    } else {
        t
    };
    u8v(eval_expr(s, symbols, allow_undefined)?, "I8")
}

fn parse_imm16_value(
    arg: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<u16, AsmError> {
    u16(
        eval_expr(&require_imm_hash(arg, "IM16")?, symbols, allow_undefined)?,
        "IM16",
    )
}

fn strip_addr_decorators(arg: &str) -> Result<String, AsmError> {
    let mut t = arg.trim().to_string();
    if t.starts_with('#') {
        return Err(AsmError::new(format!(
            "address operand must not use '#' (got '{arg}')"
        )));
    }
    if let Some(rest) = t.strip_prefix('@') {
        t = rest.trim().to_string();
    }
    if (t.starts_with('(') && t.ends_with(')')) || (t.starts_with('[') && t.ends_with(']')) {
        t = t[1..t.len() - 1].trim().to_string();
    }
    Ok(t)
}

fn parse_imm16(
    arg: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<u16, AsmError> {
    Ok((eval_expr(&strip_addr_decorators(arg)?, symbols, allow_undefined)? & 0xffff) as u16)
}

fn parse_addr_with_bb(arg: &str) -> Option<(u16, String)> {
    let t = arg.trim();
    let up = t.to_ascii_uppercase();
    for br in ["CSBR", "SSBR", "TSR0", "TSR1"] {
        let suffix = format!("({br})");
        if up.ends_with(&suffix) {
            let addr = t[..t.len() - suffix.len()].trim().to_string();
            let bb = bb_map().get(br).copied().unwrap_or(0);
            return Some((bb, addr));
        }
    }
    None
}

#[derive(Debug, Clone, Copy)]
/// メモリ／即値アドレッシング（mmm + 8bit 変位）。
struct EaMode {
    mmm: u16,
    d8: u16,
}

/// LD/STD 等の第 2 オペランド EA を mmm + d8 へ変換する。
fn parse_ea(
    arg: &str,
    pc_word: u16,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<EaMode, AsmError> {
    let t = arg.trim();
    let up = t.to_ascii_uppercase();

    if up.contains(")(") && up.starts_with("(*") {
        let idx = if up.ends_with("(X0)") {
            0b110
        } else if up.ends_with("(X1)") {
            0b111
        } else {
            return Err(AsmError::new(format!("Invalid indexed indirect EA: {arg}")));
        };
        let left = t.find("(*").unwrap_or(0) + 2;
        let right = t.find(")(").unwrap_or(t.len());
        let expr = t[left..right].trim();
        let d8 = u8v(eval_expr(expr, symbols, allow_undefined)?, "EA")?;
        return Ok(EaMode { mmm: idx, d8 });
    }

    if up.starts_with("[*") && (up.ends_with("], X0") || up.ends_with("], X1")) {
        let idx = if up.ends_with("], X0") { 0b110 } else { 0b111 };
        let comma = t.rfind(',').unwrap_or(t.len());
        let body = t[2..comma - 1].trim();
        let d8 = u8v(eval_expr(body, symbols, allow_undefined)?, "EA")?;
        return Ok(EaMode { mmm: idx, d8 });
    }

    if up.ends_with(", X0") || up.ends_with(", X1") {
        let idx = if up.ends_with(", X0") { 0b100 } else { 0b101 };
        let body = &t[..t.rfind(',').unwrap_or(t.len())];
        let d8 = u8v(eval_expr(body.trim(), symbols, allow_undefined)?, "EA")?;
        return Ok(EaMode { mmm: idx, d8 });
    }

    if t.contains('(') && t.ends_with(')') {
        let lp = t.rfind('(').unwrap_or(0);
        let base = t[lp + 1..t.len() - 1].trim().to_ascii_uppercase();
        if base == "X0" || base == "X1" {
            let d = t[..lp].trim();
            let d8 = u8v(eval_expr(d, symbols, allow_undefined)?, "EA")?;
            return Ok(EaMode {
                mmm: if base == "X0" { 0b100 } else { 0b101 },
                d8,
            });
        }
    }

    if up.starts_with("(*") && up.ends_with(')') {
        let body = t[2..t.len() - 1].trim();
        return Ok(EaMode {
            mmm: 0b010,
            d8: u8v(eval_expr(body, symbols, allow_undefined)?, "EA")?,
        });
    }
    if up.starts_with("[*") && up.ends_with(']') {
        let body = t[2..t.len() - 1].trim();
        return Ok(EaMode {
            mmm: 0b010,
            d8: u8v(eval_expr(body, symbols, allow_undefined)?, "EA")?,
        });
    }
    if up.starts_with('(') && up.ends_with(')') {
        let body = t[1..t.len() - 1].trim();
        let rel = eval_expr(body, symbols, allow_undefined)? - pc_word as i32;
        return Ok(EaMode {
            mmm: 0b011,
            d8: s8(rel, "EA relative")?,
        });
    }
    if up.starts_with('[') && up.ends_with(']') {
        let body = t[1..t.len() - 1].trim();
        let rel = eval_expr(body, symbols, allow_undefined)? - pc_word as i32;
        return Ok(EaMode {
            mmm: 0b011,
            d8: s8(rel, "EA relative")?,
        });
    }
    if let Some(rest) = t.strip_prefix('*') {
        return Ok(EaMode {
            mmm: 0b000,
            d8: u8v(eval_expr(rest.trim(), symbols, allow_undefined)?, "EA")?,
        });
    }

    let rel = eval_expr(t, symbols, allow_undefined)? - pc_word as i32;
    Ok(EaMode {
        mmm: 0b001,
        d8: s8(rel, "EA relative")?,
    })
}

fn op5(op: u16, ddd: u16, skip: u16, tail: u16) -> u16 {
    ((op & 0x1f) << 11) | ((ddd & 0x7) << 8) | ((skip & 0xf) << 4) | (tail & 0xf)
}

fn encode_mem(bit1: u16, mmm: u16, rrr: u16, d8: u16) -> u16 {
    (1 << 15) | ((bit1 & 1) << 14) | ((mmm & 0x7) << 11) | ((rrr & 0x7) << 8) | (d8 & 0xff)
}

fn expect_args(line: &ParsedLine, n_min: usize, n_max: usize) -> Result<(), AsmError> {
    if line.args.len() < n_min || line.args.len() > n_max {
        return Err(AsmError::new(format!(
            "Line {}: {} expects {}{} args",
            line.line_no,
            line.op.clone().unwrap_or_default(),
            n_min,
            if n_min != n_max {
                format!("-{n_max}")
            } else {
                String::new()
            }
        )));
    }
    Ok(())
}

/// 間接レジスタオペランドのエンコード部（ii=レジスタ番号, mm=モード）。
#[derive(Debug, Clone, Copy)]
struct IndirectReg {
    ii: u16,
    mm: u16,
}

/// `(R1)` / `(R1)+` / `-(R1)` / `@(R1)` を ii/mm へ分解する。
fn parse_indirect(arg: &str) -> Result<IndirectReg, AsmError> {
    let t = arg.trim();
    let up = t.to_ascii_uppercase();
    let map = ii_map();
    if up.starts_with("-(") && up.ends_with(')') {
        let reg = up[2..up.len() - 1].trim();
        let ii = map
            .get(reg)
            .copied()
            .ok_or_else(|| AsmError::new(format!("Invalid indirect register: {arg}")))?;
        return Ok(IndirectReg { ii, mm: 0b10 });
    }
    if up.starts_with('(') && up.ends_with(")+") {
        let reg = up[1..up.len() - 2].trim();
        let ii = map
            .get(reg)
            .copied()
            .ok_or_else(|| AsmError::new(format!("Invalid indirect register: {arg}")))?;
        return Ok(IndirectReg { ii, mm: 0b11 });
    }
    let body = if up.starts_with("@(") && up.ends_with(')') {
        &up[2..up.len() - 1]
    } else if up.starts_with('(') && up.ends_with(')') {
        &up[1..up.len() - 1]
    } else {
        ""
    };
    if !body.is_empty() {
        let ii = map
            .get(body.trim())
            .copied()
            .ok_or_else(|| AsmError::new(format!("Invalid indirect register: {arg}")))?;
        return Ok(IndirectReg { ii, mm: 0b01 });
    }
    Err(AsmError::new(format!("Invalid indirect operand: {arg}")))
}

fn parse_bb(token: &str) -> Result<u16, AsmError> {
    bb_map()
        .get(token.trim().to_ascii_uppercase().as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown base register: {token}")))
}

fn parse_bbb(token: &str, for_write: bool) -> Result<u16, AsmError> {
    let key = token.trim().to_ascii_uppercase();
    let v = bbb_map()
        .get(key.as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown base register: {token}")))?;
    if for_write && v == 0 {
        return Err(AsmError::new("CSBR cannot be written directly"));
    }
    Ok(v)
}

fn parse_ppp(token: &str) -> Result<u16, AsmError> {
    ppp_map()
        .get(token.trim().to_ascii_uppercase().as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown special register: {token}")))
}

fn parse_hhh(token: &str) -> Result<u16, AsmError> {
    hhh_map()
        .get(token.trim().to_ascii_uppercase().as_str())
        .copied()
        .ok_or_else(|| AsmError::new(format!("Unknown hardware register: {token}")))
}

fn encode_lrstr(line: &ParsedLine, indir_bit: u16) -> Result<u16, AsmError> {
    expect_args(line, 2, 3)?;
    let rrr;
    let bb;
    let indir;
    if line.args.len() == 2 {
        rrr = parse_reg(&line.args[0], true)?;
        bb = 0;
        indir = parse_indirect(&line.args[1])?;
    } else {
        rrr = parse_reg(&line.args[0], true)?;
        bb = parse_bb(&line.args[1])?;
        indir = parse_indirect(&line.args[2])?;
    }
    Ok((0b00100 << 11) | (rrr << 8) | (indir.mm << 6) | (bb << 4) | indir_bit | indir.ii)
}

fn encode_rindirect(
    line: &ParsedLine,
    opcode5: u16,
    tail_base: u16,
    skip_arg_idx: usize,
    ii_arg_idx: usize,
) -> Result<u16, AsmError> {
    let indir = parse_indirect(&line.args[ii_arg_idx])?;
    let skip = if skip_arg_idx < line.args.len() {
        parse_skip(Some(&line.args[skip_arg_idx]))?
    } else {
        0
    };
    Ok(op5(opcode5, 7, skip, tail_base | indir.ii))
}

fn parse_carry_skip(args: &[String], start_idx: usize) -> Result<(u16, u16), AsmError> {
    let mut c = 1;
    let mut i = start_idx;
    if i < args.len() && args[i].trim().eq_ignore_ascii_case("C") {
        c = 0;
        i += 1;
    }
    let skip = if i < args.len() {
        parse_skip(Some(&args[i]))?
    } else {
        0
    };
    Ok((c, skip))
}

/// 1 行を MN1613 機械語列へエンコードする。
///
/// * `pc_word` — 当該行先頭のワード PC（相対分岐の計算に使用）。
/// * `allow_undefined` — 第 1 パスでは未定義シンボルを 0 扱い可。
pub fn encode_instruction(
    line: &ParsedLine,
    pc_word: u16,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<Vec<u16>, AsmError> {
    let Some(op) = line.op.as_ref() else {
        return Err(AsmError::new(format!(
            "Line {}: missing opcode",
            line.line_no
        )));
    };
    let op = op.to_ascii_uppercase();

    match op.as_str() {
        "L" | "ST" | "B" | "BAL" | "IMS" | "DMS" => {
            let (bit1, rrr, min_args) = match op.as_str() {
                "L" => (1, parse_reg(&line.args[0], false)?, 2),
                "ST" => (0, parse_reg(&line.args[0], false)?, 2),
                "B" => (1, 0b111, 1),
                "BAL" => (0, 0b111, 1),
                "IMS" => (1, 0b110, 1),
                _ => (0, 0b110, 1),
            };
            expect_args(line, min_args, min_args + 1)?;
            let ea_str = if op == "L" || op == "ST" {
                if line.args.len() == 3 {
                    format!("{}, {}", line.args[1], line.args[2])
                } else {
                    line.args[1].clone()
                }
            } else if line.args.len() == 2 {
                format!("{}, {}", line.args[0], line.args[1])
            } else {
                line.args[0].clone()
            };
            let ea = parse_ea(&ea_str, pc_word, symbols, allow_undefined)?;
            Ok(vec![encode_mem(bit1, ea.mmm, rrr, ea.d8)])
        }
        "A" | "S" | "C" | "CB" | "MV" | "MVB" | "BSWP" | "DSWP" | "LAD" | "AND" | "OR" | "EOR" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let rs = parse_reg(&line.args[1], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            let (o, tail) = match op.as_str() {
                "A" => (0b01011, 0x8 | rs),
                "S" => (0b01011, rs),
                "C" => (0b01010, 0x8 | rs),
                "CB" => (0b01010, rs),
                "MV" => (0b01111, 0x8 | rs),
                "MVB" => (0b01111, rs),
                "BSWP" => (0b01110, 0x8 | rs),
                "DSWP" => (0b01110, rs),
                "LAD" => (0b01101, rs),
                "AND" => (0b01101, 0x8 | rs),
                "OR" => (0b01100, 0x8 | rs),
                _ => (0b01100, rs),
            };
            Ok(vec![op5(o, rd, skip, tail)])
        }
        "SR" | "SL" => {
            expect_args(line, 1, 3)?;
            let r = parse_reg(&line.args[0], true)?;
            let mut em = 0;
            let mut skip = 0;
            if line.args.len() == 2 {
                if let Ok(s) = parse_skip(Some(&line.args[1])) {
                    skip = s;
                } else {
                    em = parse_em(Some(&line.args[1]))?;
                }
            } else if line.args.len() == 3 {
                em = parse_em(Some(&line.args[1]))?;
                skip = parse_skip(Some(&line.args[2]))?;
            }
            let tail_base = if op == "SR" { 0b1000 } else { 0b1100 };
            Ok(vec![
                ((0b00100 << 11) | (r << 8) | (skip << 4) | (tail_base | em)) & 0xffff,
            ])
        }
        "SBIT" | "RBIT" | "TBIT" => {
            expect_args(line, 2, 3)?;
            let r = parse_reg(&line.args[0], true)?;
            let i4 = parse_imm4(&line.args[1], symbols, allow_undefined)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            let o = match op.as_str() {
                "TBIT" => 0b00101,
                "RBIT" => 0b00110,
                _ => 0b00111,
            };
            Ok(vec![((o << 11) | (r << 8) | (skip << 4) | i4) & 0xffff])
        }
        "AI" | "SI" => {
            expect_args(line, 2, 3)?;
            let r = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            let base =
                (((if op == "AI" { 0b01001 } else { 0b01000 }) << 11) | (r << 8) | (skip << 4))
                    & 0xffff;
            if let Some(chunks) = split_ai_si_imm4_chunks(line, symbols, allow_undefined)? {
                return Ok(chunks.into_iter().map(|i4| (base | i4) & 0xffff).collect());
            }
            let i4 = parse_imm4(&line.args[1], symbols, allow_undefined)?;
            Ok(vec![(base | i4) & 0xffff])
        }
        "LPSW" => {
            expect_args(line, 1, 1)?;
            let ll = u2(
                eval_expr(
                    &forbid_imm_hash(&line.args[0], "LPSW level")?,
                    symbols,
                    allow_undefined,
                )?,
                "LPSW level",
            )?;
            Ok(vec![((0b00100 << 11) | 0x04 | ll) & 0xffff])
        }
        "H" => {
            expect_args(line, 0, 0)?;
            Ok(vec![0x2000])
        }
        "PUSH" => {
            expect_args(line, 1, 1)?;
            let r = parse_reg(&line.args[0], true)?;
            Ok(vec![((0b00100 << 11) | (r << 8) | 0x0001) & 0xffff])
        }
        "POP" => {
            expect_args(line, 1, 1)?;
            let r = parse_reg(&line.args[0], true)?;
            Ok(vec![((0b00100 << 11) | (r << 8) | 0x0002) & 0xffff])
        }
        "RET" => {
            expect_args(line, 0, 0)?;
            Ok(vec![((0b00100 << 11) | 0x0003) & 0xffff])
        }
        "RD" => {
            expect_args(line, 2, 2)?;
            let r = parse_reg(&line.args[0], true)?;
            Ok(vec![
                ((0b00011 << 11)
                    | (r << 8)
                    | parse_io_addr8(&line.args[1], symbols, allow_undefined)?)
                    & 0xffff,
            ])
        }
        "WT" => {
            expect_args(line, 2, 2)?;
            let r = parse_reg(&line.args[0], true)?;
            Ok(vec![
                ((0b00010 << 11)
                    | (r << 8)
                    | parse_io_addr8(&line.args[1], symbols, allow_undefined)?)
                    & 0xffff,
            ])
        }
        "MVI" => {
            expect_args(line, 2, 2)?;
            let r = parse_reg(&line.args[0], true)?;
            Ok(vec![
                ((0b00001 << 11) | (r << 8) | parse_imm8(&line.args[1], symbols, allow_undefined)?)
                    & 0xffff,
            ])
        }
        "LD" => {
            expect_args(line, 2, 3)?;
            let r = parse_reg(&line.args[0], false)?;
            let (bb, ad16) = if line.args.len() == 2 {
                if let Some((bb, addr)) = parse_addr_with_bb(&line.args[1]) {
                    (bb, parse_imm16(&addr, symbols, allow_undefined)?)
                } else {
                    (0, parse_imm16(&line.args[1], symbols, allow_undefined)?)
                }
            } else {
                (
                    parse_bb(&line.args[1])?,
                    parse_imm16(&line.args[2], symbols, allow_undefined)?,
                )
            };
            Ok(vec![0x2700 | (bb << 4) | 0x08 | r, ad16])
        }
        "STD" => {
            expect_args(line, 2, 3)?;
            let r = parse_reg(&line.args[0], false)?;
            let (bb, ad16) = if line.args.len() == 2 {
                if let Some((bb, addr)) = parse_addr_with_bb(&line.args[1]) {
                    (bb, parse_imm16(&addr, symbols, allow_undefined)?)
                } else {
                    (0, parse_imm16(&line.args[1], symbols, allow_undefined)?)
                }
            } else {
                (
                    parse_bb(&line.args[1])?,
                    parse_imm16(&line.args[2], symbols, allow_undefined)?,
                )
            };
            Ok(vec![0x2700 | 0x40 | (bb << 4) | 0x08 | r, ad16])
        }
        "LR" => Ok(vec![encode_lrstr(line, 0x00)?]),
        "STR" => Ok(vec![encode_lrstr(line, 0x04)?]),
        "MVWR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01111, 0x08, 2, 1)?])
        }
        "MVWI" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                op5(0b01111, rd, skip, 0x07),
                parse_imm16_value(&line.args[1], symbols, allow_undefined)?,
            ])
        }
        "MVBR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01111, 0x00, 2, 1)?])
        }
        "BSWR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01110, 0x08, 2, 1)?])
        }
        "DSWR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01110, 0x00, 2, 1)?])
        }
        "PSHM" => {
            expect_args(line, 0, 0)?;
            Ok(vec![0x170f])
        }
        "POPM" => {
            expect_args(line, 0, 0)?;
            Ok(vec![0x1707])
        }
        "AWR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01011, 0x08, 2, 1)?])
        }
        "AWI" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                op5(0b01011, rd, skip, 0x0f),
                parse_imm16_value(&line.args[1], symbols, allow_undefined)?,
            ])
        }
        "SWR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01011, 0x00, 2, 1)?])
        }
        "SWI" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                op5(0b01011, rd, skip, 0x07),
                parse_imm16_value(&line.args[1], symbols, allow_undefined)?,
            ])
        }
        "CWR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01010, 0x08, 2, 1)?])
        }
        "CWI" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                op5(0b01010, rd, skip, 0x0f),
                parse_imm16_value(&line.args[1], symbols, allow_undefined)?,
            ])
        }
        "CBR" => {
            expect_args(line, 2, 3)?;
            Ok(vec![encode_rindirect(line, 0b01010, 0x00, 2, 1)?])
        }
        "CBI" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                op5(0b01010, rd, skip, 0x07),
                parse_imm16_value(&line.args[1], symbols, allow_undefined)?,
            ])
        }
        "NEG" => {
            expect_args(line, 1, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let (c, skip) = parse_carry_skip(&line.args, 1)?;
            Ok(vec![
                ((0b00011 << 11) | (7 << 8) | (skip << 4) | (c << 3) | rd) & 0xffff,
            ])
        }
        "AD" => {
            expect_args(line, 2, 4)?;
            require_dr0(&line.args[0])?;
            let ii = parse_dr0_mem_ri(&line.args[1])?;
            let (c, skip) = parse_carry_skip(&line.args, 2)?;
            Ok(vec![op5(0b01001, 7, skip, (c << 3) | 0x04 | ii)])
        }
        "SD" => {
            expect_args(line, 2, 4)?;
            require_dr0(&line.args[0])?;
            let ii = parse_dr0_mem_ri(&line.args[1])?;
            let (c, skip) = parse_carry_skip(&line.args, 2)?;
            Ok(vec![op5(0b01000, 7, skip, (c << 3) | 0x04 | ii)])
        }
        "M" => {
            expect_args(line, 2, 3)?;
            require_dr0(&line.args[0])?;
            let ii = parse_dr0_mem_ri(&line.args[1])?;
            let skip = if line.args.len() > 2 {
                parse_skip(Some(&line.args[2]))?
            } else {
                0
            };
            Ok(vec![op5(0b01111, 7, skip, 0x0c | ii)])
        }
        "D" => {
            expect_args(line, 2, 3)?;
            require_dr0(&line.args[0])?;
            let ii = parse_dr0_mem_ri(&line.args[1])?;
            let skip = if line.args.len() > 2 {
                parse_skip(Some(&line.args[2]))?
            } else {
                0
            };
            Ok(vec![op5(0b01110, 7, skip, 0x0c | ii)])
        }
        "DAA" => {
            expect_args(line, 2, 4)?;
            let indir = parse_indirect(&line.args[1])?;
            let (c, skip) = parse_carry_skip(&line.args, 2)?;
            Ok(vec![op5(0b01011, 7, skip, (c << 3) | 0x04 | indir.ii)])
        }
        "DAS" => {
            expect_args(line, 2, 4)?;
            let indir = parse_indirect(&line.args[1])?;
            let (c, skip) = parse_carry_skip(&line.args, 2)?;
            Ok(vec![op5(0b01010, 7, skip, (c << 3) | 0x04 | indir.ii)])
        }
        "LADR" | "ANDR" | "ORR" | "EORR" | "FA" | "FS" | "FM" | "FD" => {
            expect_args(line, 2, 3)?;
            let tail = match op.as_str() {
                "LADR" => 0x00,
                "ANDR" => 0x08,
                "ORR" => 0x08,
                "EORR" => 0x00,
                "FA" => 0x0c,
                "FS" => 0x04,
                "FM" => 0x0c,
                _ => 0x04,
            };
            let opc = match op.as_str() {
                "LADR" | "ANDR" | "FA" | "FS" => 0b01101,
                _ => 0b01100,
            };
            Ok(vec![encode_rindirect(line, opc, tail, 2, 1)?])
        }
        "FIX" => {
            expect_args(line, 2, 3)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                ((0b00011 << 11) | (7 << 8) | (skip << 4) | 0x04) & 0xffff,
            ])
        }
        "FLT" => {
            expect_args(line, 2, 3)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            Ok(vec![
                ((0b00011 << 11) | (7 << 8) | (skip << 4) | 0x0c) & 0xffff,
            ])
        }
        "LADI" | "ANDI" | "ORI" | "EORI" => {
            expect_args(line, 2, 3)?;
            let rd = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            let (opc, tail) = match op.as_str() {
                "LADI" => (0b01101, 0x07),
                "ANDI" => (0b01101, 0x0f),
                "ORI" => (0b01100, 0x0f),
                _ => (0b01100, 0x07),
            };
            Ok(vec![
                op5(opc, rd, skip, tail),
                parse_imm16_value(&line.args[1], symbols, allow_undefined)?,
            ])
        }
        "BD" => {
            expect_args(line, 1, 1)?;
            Ok(vec![
                0x2607,
                parse_imm16(&line.args[0], symbols, allow_undefined)?,
            ])
        }
        "BL" => {
            expect_args(line, 1, 1)?;
            Ok(vec![
                0x270f,
                parse_imm16(&line.args[0], symbols, allow_undefined)?,
            ])
        }
        "BALD" => {
            expect_args(line, 1, 1)?;
            Ok(vec![
                0x2617,
                parse_imm16(&line.args[0], symbols, allow_undefined)?,
            ])
        }
        "BALL" => {
            expect_args(line, 1, 1)?;
            Ok(vec![
                0x271f,
                parse_imm16(&line.args[0], symbols, allow_undefined)?,
            ])
        }
        "BR" | "BALR" => {
            expect_args(line, 1, 1)?;
            let indir = parse_indirect(&line.args[0])?;
            let low = if op == "BR" { 0x04 } else { 0x14 };
            Ok(vec![((0b00100 << 11) | (7 << 8) | low | indir.ii) & 0xffff])
        }
        "RETL" => {
            expect_args(line, 0, 0)?;
            Ok(vec![0x3f07])
        }
        "TSET" | "TRST" => {
            expect_args(line, 2, 3)?;
            let rs = parse_reg(&line.args[0], true)?;
            let skip = parse_skip(line.args.get(2).map(|s| s.as_str()))?;
            let ad16 = parse_imm16(&line.args[1], symbols, allow_undefined)?;
            let lo = if op == "TSET" { 0x08 | rs } else { rs };
            Ok(vec![
                ((0b00010 << 11) | (7 << 8) | (skip << 4) | lo) & 0xffff,
                ad16,
            ])
        }
        "SRBT" => {
            expect_args(line, 2, 2)?;
            let rs = parse_reg(&line.args[1], true)?;
            Ok(vec![0x3f70 | rs])
        }
        "DEBP" => {
            expect_args(line, 2, 2)?;
            let rd = parse_reg(&line.args[0], true)?;
            Ok(vec![0x3ff0 | rd])
        }
        "BLK" => {
            expect_args(line, 0, 0)?;
            Ok(vec![0x3f17])
        }
        "RDR" | "WTR" => {
            expect_args(line, 2, 2)?;
            let r = parse_reg(&line.args[0], true)?;
            let indir = parse_indirect(&line.args[1])?;
            let lo = if op == "RDR" { 0x14 } else { 0x10 };
            Ok(vec![((0b00100 << 11) | (r << 8) | lo | indir.ii) & 0xffff])
        }
        "LB" | "LS" | "STB" | "STS" => {
            expect_args(line, 2, 2)?;
            let (x, ad16) = match op.as_str() {
                "LB" => (
                    0x0f00 | (parse_bbb(&line.args[0], false)? << 4) | 0x07,
                    parse_imm16(&line.args[1], symbols, allow_undefined)?,
                ),
                "LS" => (
                    0x0f00 | (parse_ppp(&line.args[0])? << 4) | 0x0f,
                    parse_imm16(&line.args[1], symbols, allow_undefined)?,
                ),
                "STB" => (
                    0x0f00 | 0x80 | (parse_bbb(&line.args[0], true)? << 4) | 0x07,
                    parse_imm16(&line.args[1], symbols, allow_undefined)?,
                ),
                _ => (
                    0x0f00 | 0x80 | (parse_ppp(&line.args[0])? << 4) | 0x0f,
                    parse_imm16(&line.args[1], symbols, allow_undefined)?,
                ),
            };
            Ok(vec![x, ad16])
        }
        "CPYB" | "CPYS" | "CPYH" | "SETB" | "SETS" | "SETH" => {
            expect_args(line, 2, 2)?;
            let rsrd = parse_reg(&line.args[0], true)?;
            let v = match op.as_str() {
                "CPYB" => 0x0f00 | 0x80 | (parse_bbb(&line.args[1], false)? << 4) | rsrd,
                "CPYS" => 0x0f00 | 0x80 | (parse_ppp(&line.args[1])? << 4) | 0x08 | rsrd,
                "CPYH" => 0x3f00 | 0x80 | (parse_hhh(&line.args[1])? << 4) | rsrd,
                "SETB" => 0x0f00 | (parse_bbb(&line.args[1], true)? << 4) | rsrd,
                "SETS" => 0x0f00 | (parse_ppp(&line.args[1])? << 4) | 0x08 | rsrd,
                _ => 0x3f00 | (parse_hhh(&line.args[1])? << 4) | rsrd,
            };
            Ok(vec![v])
        }
        _ => Err(AsmError::new(format!(
            "Line {}: Unsupported opcode '{}'",
            line.line_no,
            line.op.clone().unwrap_or_default()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use crate::assembler::assemble;
    use crate::cpu_type::CpuType;
    use crate::mn1613::all_instruction_cases::MN1613_ENCODE_CASES;

    /// 1 行の MN1613 命令をアセンブルし、語列を返す。
    fn asm_words(src: &str) -> Vec<u16> {
        assemble(
            &format!("        .org 0\n        {src}\n"),
            Some(CpuType::Mn1613),
        )
        .expect("assemble")
        .words
        .into_iter()
        .map(|w| w.value)
        .collect()
    }

    /// MN1613 新設命令のエンコード期待値（TS 版テスト表と同一）。
    #[test]
    fn all_instructions_encode() {
        for (src, expected) in MN1613_ENCODE_CASES {
            assert_eq!(
                asm_words(src),
                *expected,
                "MN1613 encode mismatch: {src}"
            );
        }
    }
}
