//! TMS9995 命令エンコーダ。
//!
//! 根拠: `.cursor/rules/TMS9995_instruction.mdc` / `asm_rules.mdc`
//! アドレスはバイト単位。命令語は 1〜3 ワード。構文は sdas 風。

use std::collections::HashMap;

use crate::error::AsmError;
use crate::expression::eval_expr;
use crate::types::ParsedLine;

/// 汎用アドレス（Ts/Td）。
struct GeneralAddr {
    /// 00=reg 01=(R) 10=symbolic/indexed 11=(R)+
    mode: u16,
    reg: u16,
    /// シンボリック / インデックス時の追加ワード
    extra_word: Option<u16>,
}

fn eval_tms(expr: &str, symbols: &HashMap<String, u16>, allow_undefined: bool) -> Result<i32, AsmError> {
    Ok(eval_expr(expr, symbols, allow_undefined)? & 0xffff)
}

fn require_imm(
    raw: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
    line_no: usize,
) -> Result<i32, AsmError> {
    let s = raw.trim();
    if !s.starts_with('#') {
        return Err(AsmError::new(format!(
            "Line {line_no}: immediate requires '#' (sdas; got '{raw}')"
        )));
    }
    eval_tms(s[1..].trim(), symbols, allow_undefined)
}

fn require_imm_range(
    raw: &str,
    lo: i32,
    hi: i32,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
    line_no: usize,
    what: &str,
) -> Result<i32, AsmError> {
    let v = require_imm(raw, symbols, allow_undefined, line_no)?;
    let s = (v << 16) >> 16;
    if !allow_undefined && (s < lo || s > hi) {
        return Err(AsmError::new(format!(
            "Line {line_no}: {what} {s} out of range ({lo}..{hi})"
        )));
    }
    Ok(if allow_undefined { 0 } else { s })
}

fn parse_reg(tok: &str) -> Option<u16> {
    let up = tok.trim().to_ascii_uppercase();
    if !up.starts_with('R') || up.len() < 2 {
        return None;
    }
    let num: u16 = up[1..].parse().ok()?;
    if num <= 15 { Some(num) } else { None }
}

fn is_ti_star_reg(s: &str) -> bool {
    let up = s.trim().to_ascii_uppercase();
    if !up.starts_with('*') {
        return false;
    }
    parse_reg(up[1..].trim_start()).is_some()
}

/// 汎用アドレスオペランドを解析する。
fn parse_general_addr(
    raw: &str,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
    line_no: usize,
) -> Result<GeneralAddr, AsmError> {
    let s = raw.trim();
    if s.is_empty() {
        return Err(AsmError::new(format!("Line {line_no}: empty addressing operand")));
    }
    if s.starts_with('#') {
        return Err(AsmError::new(format!(
            "Line {line_no}: '#' is immediate-only (use LI/AI/…; got '{raw}')"
        )));
    }
    if s.starts_with('@') {
        return Err(AsmError::new(format!(
            "Line {line_no}: TI syntax is not used (sdas: (Rn), (Rn)+, label, addr(Rn); got '{raw}')"
        )));
    }
    if is_ti_star_reg(s) {
        return Err(AsmError::new(format!(
            "Line {line_no}: TI syntax is not used (sdas: (Rn), (Rn)+, label, addr(Rn); got '{raw}')"
        )));
    }

    let up = s.to_ascii_uppercase();

    // (Rn)+ / [Rn]+
    if (up.starts_with('(') || up.starts_with('['))
        && (up.ends_with(")+") || up.ends_with("]+"))
    {
        let inner = if up.starts_with('(') {
            &up[1..up.len() - 2]
        } else {
            &up[1..up.len() - 2]
        };
        if let Some(reg) = parse_reg(inner.trim()) {
            return Ok(GeneralAddr {
                mode: 0b11,
                reg,
                extra_word: None,
            });
        }
    }

    // (Rn) / [Rn]
    if (up.starts_with('(') && up.ends_with(')')) || (up.starts_with('[') && up.ends_with(']')) {
        let inner = if up.starts_with('(') {
            &up[1..up.len() - 1]
        } else {
            &up[1..up.len() - 1]
        };
        if let Some(reg) = parse_reg(inner.trim()) {
            return Ok(GeneralAddr {
                mode: 0b01,
                reg,
                extra_word: None,
            });
        }
    }

    // Rn
    if let Some(reg) = parse_reg(s) {
        return Ok(GeneralAddr {
            mode: 0b00,
            reg,
            extra_word: None,
        });
    }

    // addr(Rn) / addr[Rn]
    if let Some(lp) = up.rfind('(').or_else(|| up.rfind('[')) {
        if up.ends_with(')') || up.ends_with(']') {
            let rp = up.len() - 1;
            let reg_str = up[lp + 1..rp].trim();
            if let Some(reg) = parse_reg(reg_str) {
                if reg == 0 {
                    return Err(AsmError::new(format!(
                        "Line {line_no}: indexed addressing cannot use R0 (use a label / address)"
                    )));
                }
                let addr_expr = s[..lp].trim();
                return Ok(GeneralAddr {
                    mode: 0b10,
                    reg,
                    extra_word: Some(eval_tms(addr_expr, symbols, allow_undefined)? as u16),
                });
            }
        }
    }

    // symbolic / 直接
    Ok(GeneralAddr {
        mode: 0b10,
        reg: 0,
        extra_word: Some(eval_tms(s, symbols, allow_undefined)? as u16),
    })
}

fn pack_addr(a: &GeneralAddr) -> (u16, Vec<u16>) {
    let field6 = ((a.mode & 3) << 4) | (a.reg & 0xf);
    let extras = a
        .extra_word
        .map(|w| vec![w & 0xffff])
        .unwrap_or_default();
    (field6, extras)
}

fn fmt1_op(op: &str) -> Option<u16> {
    match op {
        "SZC" => Some(0x4000),
        "SZCB" => Some(0x5000),
        "S" => Some(0x6000),
        "SB" => Some(0x7000),
        "C" => Some(0x8000),
        "CB" => Some(0x9000),
        "A" => Some(0xa000),
        "AB" => Some(0xb000),
        "MOV" => Some(0xc000),
        "MOVB" => Some(0xd000),
        "SOC" => Some(0xe000),
        "SOCB" => Some(0xf000),
        _ => None,
    }
}

fn fmt2_jump_op(op: &str) -> Option<u16> {
    match op {
        "JMP" => Some(0x1000),
        "JLT" => Some(0x1100),
        "JLE" => Some(0x1200),
        "JEQ" => Some(0x1300),
        "JHE" => Some(0x1400),
        "JGT" => Some(0x1500),
        "JNE" => Some(0x1600),
        "JNC" => Some(0x1700),
        "JOC" => Some(0x1800),
        "JNO" => Some(0x1900),
        "JL" => Some(0x1a00),
        "JH" => Some(0x1b00),
        "JOP" => Some(0x1c00),
        _ => None,
    }
}

fn fmt2_cru_op(op: &str) -> Option<u16> {
    match op {
        "SBO" => Some(0x1d00),
        "SBZ" => Some(0x1e00),
        "TB" => Some(0x1f00),
        _ => None,
    }
}

fn fmt3_op(op: &str) -> Option<u16> {
    match op {
        "COC" => Some(0x2000),
        "CZC" => Some(0x2400),
        "XOR" => Some(0x2800),
        _ => None,
    }
}

fn fmt4_op(op: &str) -> Option<u16> {
    match op {
        "LDCR" => Some(0x3000),
        "STCR" => Some(0x3400),
        _ => None,
    }
}

fn fmt5_op(op: &str) -> Option<u16> {
    match op {
        "SRA" => Some(0x0800),
        "SRL" => Some(0x0900),
        "SLA" => Some(0x0a00),
        "SRC" => Some(0x0b00),
        _ => None,
    }
}

fn fmt6_op(op: &str) -> Option<u16> {
    match op {
        "BLWP" => Some(0x0400),
        "B" => Some(0x0440),
        "X" => Some(0x0480),
        "CLR" => Some(0x04c0),
        "NEG" => Some(0x0500),
        "INV" => Some(0x0540),
        "INC" => Some(0x0580),
        "INCT" => Some(0x05c0),
        "DEC" => Some(0x0600),
        "DECT" => Some(0x0640),
        "BL" => Some(0x0680),
        "SWPB" => Some(0x06c0),
        "SETO" => Some(0x0700),
        "ABS" => Some(0x0740),
        "DIVS" => Some(0x0180),
        "MPYS" => Some(0x01c0),
        _ => None,
    }
}

fn fmt8_reg_imm_op(op: &str) -> Option<u16> {
    match op {
        "LI" => Some(0x0200),
        "AI" => Some(0x0220),
        "ANDI" => Some(0x0240),
        "ORI" => Some(0x0260),
        "CI" => Some(0x0280),
        _ => None,
    }
}

fn fmt9_op(op: &str) -> Option<u16> {
    match op {
        "XOP" => Some(0x2c00),
        "MPY" => Some(0x3800),
        "DIV" => Some(0x3c00),
        _ => None,
    }
}

fn fmt7_fixed_op(op: &str) -> Option<u16> {
    match op {
        "IDLE" => Some(0x0340),
        "RSET" => Some(0x0360),
        "RTWP" => Some(0x0380),
        "CKON" => Some(0x03a0),
        "CKOF" => Some(0x03c0),
        "LREX" => Some(0x03e0),
        _ => None,
    }
}

/// TMS9995 命令が消費するバイト数（第 1 パス用）。
pub fn instruction_size(line: &ParsedLine) -> Result<u16, AsmError> {
    let words = encode_instruction(line, 0, &HashMap::new(), true)?;
    Ok((words.len() as u16) * 2)
}

/// TMS9995 命令をエンコードする。
///
/// * `pc_byte` — 命令先頭のバイトアドレス（相対ジャンプ計算用）。
/// * `allow_undefined` — 第 1 パス（サイズ計算）では未定義シンボルを 0 扱い可。
pub fn encode_instruction(
    line: &ParsedLine,
    pc_byte: u16,
    symbols: &HashMap<String, u16>,
    allow_undefined: bool,
) -> Result<Vec<u16>, AsmError> {
    let Some(op_raw) = line.op.as_ref() else {
        return Ok(Vec::new());
    };
    let op = op_raw.to_ascii_uppercase();
    let args: Vec<&str> = line.args.iter().map(|s| s.trim()).collect();
    let line_no = line.line_no;

    // RT → B (R11)
    if op == "RT" {
        if !args.is_empty() {
            return Err(AsmError::new(format!("Line {line_no}: RT takes no operands")));
        }
        let mut rt_line = line.clone();
        rt_line.op = Some("B".to_string());
        rt_line.args = vec!["(R11)".to_string()];
        return encode_instruction(&rt_line, pc_byte, symbols, allow_undefined);
    }

    // NOP → JMP $+0
    if op == "NOP" {
        if !args.is_empty() {
            return Err(AsmError::new(format!("Line {line_no}: NOP takes no operands")));
        }
        return Ok(vec![0x1000]);
    }

    if let Some(base) = fmt7_fixed_op(&op) {
        if !args.is_empty() {
            return Err(AsmError::new(format!("Line {line_no}: {op} takes no operands")));
        }
        return Ok(vec![base]);
    }

    if op == "LWPI" || op == "LIMI" {
        if args.len() != 1 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires one immediate"
            )));
        }
        let base = if op == "LWPI" { 0x02e0 } else { 0x0300 };
        let imm = require_imm(args[0], symbols, allow_undefined, line_no)? as u16;
        return Ok(vec![base, imm]);
    }

    if matches!(op.as_str(), "STWP" | "STST" | "LST" | "LWP") {
        if args.len() != 1 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires one register"
            )));
        }
        let r = parse_reg(args[0]).ok_or_else(|| {
            AsmError::new(format!("Line {line_no}: {op} requires Rn"))
        })?;
        let base = match op.as_str() {
            "STWP" => 0x02a0,
            "STST" => 0x02c0,
            "LST" => 0x0080,
            _ => 0x0090,
        };
        return Ok(vec![base | (r & 0xf)]);
    }

    if let Some(base) = fmt8_reg_imm_op(&op) {
        if args.len() != 2 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires Rn, imm"
            )));
        }
        let r = parse_reg(args[0]).ok_or_else(|| {
            AsmError::new(format!("Line {line_no}: {op} first operand must be Rn"))
        })?;
        let imm = require_imm(args[1], symbols, allow_undefined, line_no)? as u16;
        return Ok(vec![base | (r & 0xf), imm]);
    }

    if let Some(base) = fmt2_cru_op(&op) {
        if args.len() != 1 {
            return Err(AsmError::new(format!("Line {line_no}: {op} requires #disp")));
        }
        let disp = require_imm_range(
            args[0],
            -128,
            127,
            symbols,
            allow_undefined,
            line_no,
            &format!("{op} displacement"),
        )?;
        return Ok(vec![base | (disp as u16 & 0xff)]);
    }

    if let Some(base) = fmt2_jump_op(&op) {
        if args.len() != 1 {
            return Err(AsmError::new(format!("Line {line_no}: {op} requires a label")));
        }
        let target = eval_tms(args[0], symbols, allow_undefined)? as i32;
        let next_pc = pc_byte as i32 + 2;
        let disp_words = if allow_undefined {
            0
        } else {
            (target - next_pc) / 2
        };
        if !allow_undefined && (target - next_pc) % 2 != 0 {
            return Err(AsmError::new(format!(
                "Line {line_no}: jump target {} is not word-aligned relative to PC",
                args[0]
            )));
        }
        if !allow_undefined && (disp_words < -128 || disp_words > 127) {
            return Err(AsmError::new(format!(
                "Line {line_no}: jump displacement {disp_words} out of range (-128..127)"
            )));
        }
        return Ok(vec![base | (disp_words as u16 & 0xff)]);
    }

    if let Some(base) = fmt5_op(&op) {
        if args.len() != 2 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires Rn, #count"
            )));
        }
        let r = parse_reg(args[0]).ok_or_else(|| {
            AsmError::new(format!("Line {line_no}: {op} first operand must be Rn"))
        })?;
        let cnt = require_imm_range(
            args[1],
            0,
            15,
            symbols,
            allow_undefined,
            line_no,
            &format!("{op} count"),
        )?;
        return Ok(vec![base | (((cnt as u16) & 0xf) << 4) | (r & 0xf)]);
    }

    if let Some(base) = fmt3_op(&op) {
        if args.len() != 2 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires src, Rn"
            )));
        }
        let r = parse_reg(args[1]).ok_or_else(|| {
            AsmError::new(format!("Line {line_no}: {op} second operand must be Rn"))
        })?;
        let src = parse_general_addr(args[0], symbols, allow_undefined, line_no)?;
        let (field6, extras) = pack_addr(&src);
        return Ok({
            let mut out = vec![base | ((r & 0xf) << 6) | field6];
            out.extend(extras);
            out
        });
    }

    if let Some(base) = fmt4_op(&op) {
        if args.len() != 2 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires addr, #bits"
            )));
        }
        let bits = require_imm_range(
            args[1],
            0,
            16,
            symbols,
            allow_undefined,
            line_no,
            &format!("{op} bit count"),
        )?;
        if !allow_undefined && bits > 16 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} bit count {bits} out of range"
            )));
        }
        let cccc = if bits == 16 || bits == 0 { 0 } else { bits };
        let src = parse_general_addr(args[0], symbols, allow_undefined, line_no)?;
        let (field6, extras) = pack_addr(&src);
        return Ok({
            let mut out = vec![base | (((cccc as u16) & 0xf) << 6) | field6];
            out.extend(extras);
            out
        });
    }

    if let Some(base) = fmt9_op(&op) {
        if args.len() != 2 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires two operands"
            )));
        }
        let src = parse_general_addr(args[0], symbols, allow_undefined, line_no)?;
        let (field6, extras) = pack_addr(&src);
        if op == "XOP" {
            let n = require_imm_range(
                args[1],
                0,
                15,
                symbols,
                allow_undefined,
                line_no,
                "XOP number",
            )?;
            return Ok({
                let mut out = vec![base | (((n as u16) & 0xf) << 6) | field6];
                out.extend(extras);
                out
            });
        }
        let r = parse_reg(args[1]).ok_or_else(|| {
            AsmError::new(format!("Line {line_no}: {op} second operand must be Rn"))
        })?;
        return Ok({
            let mut out = vec![base | ((r & 0xf) << 6) | field6];
            out.extend(extras);
            out
        });
    }

    if let Some(base) = fmt6_op(&op) {
        if args.len() != 1 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires one operand"
            )));
        }
        let a = parse_general_addr(args[0], symbols, allow_undefined, line_no)?;
        let (field6, extras) = pack_addr(&a);
        return Ok({
            let mut out = vec![base | field6];
            out.extend(extras);
            out
        });
    }

    if let Some(base) = fmt1_op(&op) {
        if args.len() != 2 {
            return Err(AsmError::new(format!(
                "Line {line_no}: {op} requires src, dst"
            )));
        }
        let src = parse_general_addr(args[0], symbols, allow_undefined, line_no)?;
        let dst = parse_general_addr(args[1], symbols, allow_undefined, line_no)?;
        let (_s_field, s_extras) = pack_addr(&src);
        let (_d_field, d_extras) = pack_addr(&dst);
        let word = base
            | ((dst.mode & 3) << 10)
            | ((dst.reg & 0xf) << 6)
            | ((src.mode & 3) << 4)
            | (src.reg & 0xf);
        return Ok({
            let mut out = vec![word];
            out.extend(s_extras);
            out.extend(d_extras);
            out
        });
    }

    Err(AsmError::new(format!(
        "Line {line_no}: unknown TMS9995 opcode '{op_raw}'"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assembler::assemble;
    use crate::cpu_type::CpuType;
    use crate::parser::parse_source;

    fn asm_words(src: &str) -> Vec<u16> {
        assemble(
            &format!("        .org 0\n{src}\n"),
            Some(CpuType::Tms9995),
        )
        .expect("assemble")
        .words
        .into_iter()
        .map(|w| w.value)
        .collect()
    }

    fn asm1(src: &str) -> u16 {
        asm_words(src)[0]
    }

    #[test]
    fn li_ai_ci() {
        assert_eq!(asm_words("        LI R1, #0x1234"), vec![0x0201, 0x1234]);
        assert_eq!(asm_words("        AI R0, #1"), vec![0x0220, 0x0001]);
        assert_eq!(asm_words("        CI R1, #0x0100"), vec![0x0281, 0x0100]);
    }

    #[test]
    fn format1_mov() {
        assert_eq!(asm1("        MOV R1, R2"), 0xc081);
        assert_eq!(asm1("        A R2, R1"), 0xa042);
        assert_eq!(asm1("        MOV (R3)+, R0"), 0xc033);
    }

    #[test]
    fn format6_rt_nop() {
        assert_eq!(asm1("        CLR R0"), 0x04c0);
        assert_eq!(asm1("        RT"), 0x045b);
        assert_eq!(asm1("        B (R11)"), 0x045b);
        assert_eq!(asm1("        RTWP"), 0x0380);
        assert_eq!(asm1("        NOP"), 0x1000);
    }

    #[test]
    fn symbolic_mov_byte_addr() {
        let src = "        .org 0x1000\nLAB:    .word 0xABCD\n        MOV LAB, R0\n";
        let r = assemble(src, Some(CpuType::Tms9995)).expect("assemble");
        let mov: Vec<_> = r.words.iter().filter(|w| w.address >= 0x1002).collect();
        assert_eq!(mov[0].value, 0xc020);
        assert_eq!(mov[1].value, 0x1000);
        assert_eq!(r.symbols.get("LAB"), Some(&0x1000));
    }

    #[test]
    fn reject_ti_syntax() {
        let err = assemble("        .org 0\n        B @START\n", Some(CpuType::Tms9995));
        assert!(err.is_err());
        let msg = err.unwrap_err().to_string();
        assert!(msg.contains("TI syntax is not used"));
    }

    #[test]
    fn all_mnemonics_smoke() {
        let cases: &[(&str, &[u16])] = &[
            ("SZC R1, R2", &[0x4081]),
            ("MOV R1, R2", &[0xc081]),
            ("JMP 2", &[0x1000]),
            ("SBO #0", &[0x1d00]),
            ("TB #-1", &[0x1fff]),
            ("DIVS R0", &[0x0180]),
            ("MPYS R0", &[0x01c0]),
            ("LI R1, #1", &[0x0201, 0x0001]),
            ("LST R1", &[0x0081]),
        ];
        for (src, expected) in cases {
            assert_eq!(asm_words(&format!("        {src}")), *expected, "{src}");
        }
    }

    #[test]
    fn instruction_size_matches_encode() {
        let src = "        MOV R1, R2\n        LI R0, #1\n";
        let (_, parsed) = parse_source(src).expect("parse");
        for line in parsed.iter().filter(|l| l.op.is_some()) {
            let sz = instruction_size(line).expect("size");
            let enc = encode_instruction(line, 0, &HashMap::new(), true).expect("enc");
            assert_eq!(sz, (enc.len() as u16) * 2);
        }
    }

    #[test]
    fn sample_all_instructions() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../retrocpu_asm_ts/sample/tms9995_all_instructions.asm"
        );
        let src = std::fs::read_to_string(path).expect("read sample");
        let r = assemble(&src, None).expect("assemble sample");
        assert_eq!(r.address_unit, crate::types::AddressUnit::Byte);
        assert!(r.words.len() > 50);
        assert_eq!(r.symbols.get("START"), Some(&0x1000));
    }
}
