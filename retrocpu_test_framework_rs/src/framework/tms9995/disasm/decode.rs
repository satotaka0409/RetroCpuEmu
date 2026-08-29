//! TMS9995 1 命令デコード（構造化オペランド）。
//!
//! 根拠: TMS9995_instruction.mdc / retrocpu_asm_rs `tms9995_encoder.rs`

/// デコード済みオペランド。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodedOp {
    /// ワークスペースレジスタ R0–R15
    Reg(u16),
    /// 間接 `(Rn)`
    Indirect(u16),
    /// オートインクリメント `(Rn)+`
    AutoInc(u16),
    /// シンボリック（絶対バイトアドレス）
    Sym(u16),
    /// インデックス `addr(Rn)`
    Indexed { addr: u16, reg: u16 },
    /// 即値 `#n`（16bit）
    Imm(u16),
    /// 即値 `#n`（符号付き 8bit、SBO/SBZ/TB）
    ImmDisp(i8),
    /// 即値 `#count`（0–15、LDCR/STCR/シフト）
    ImmCount(u8),
    /// 相対／絶対ジャンプ先（バイトアドレス）
    JumpTarget(u16),
    /// XOP 番号 0–15
    XopNum(u8),
}

/// 1 命令のデコード結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedInst {
    pub mnemonic: String,
    pub ops: Vec<DecodedOp>,
    pub word_count: u8,
    pub ir: u16,
}

/// レジスタ名 R0–R15。
pub fn reg_name(r: u16) -> String {
    format!("R{}", r & 0xf)
}

fn undef(ir: u16) -> DecodedInst {
    DecodedInst {
        mnemonic: ".word".into(),
        ops: vec![DecodedOp::Imm(ir & 0xffff)],
        word_count: 1,
        ir,
    }
}

fn fixed(mnemonic: &str, ir: u16) -> DecodedInst {
    DecodedInst {
        mnemonic: mnemonic.to_string(),
        ops: vec![],
        word_count: 1,
        ir,
    }
}

fn one(mnemonic: &str, ir: u16, op: DecodedOp) -> DecodedInst {
    DecodedInst {
        mnemonic: mnemonic.to_string(),
        ops: vec![op],
        word_count: 1,
        ir,
    }
}

fn two(mnemonic: &str, ir: u16, a: DecodedOp, b: DecodedOp) -> DecodedInst {
    DecodedInst {
        mnemonic: mnemonic.to_string(),
        ops: vec![a, b],
        word_count: 1,
        ir,
    }
}

fn with_words(mnemonic: &str, ir: u16, ops: Vec<DecodedOp>, word_count: u8) -> DecodedInst {
    DecodedInst {
        mnemonic: mnemonic.to_string(),
        ops,
        word_count,
        ir,
    }
}

fn read_at_byte(byte_addr: u16, read_word: &impl Fn(u16) -> u16) -> u16 {
    read_word(byte_addr & 0xffff)
}

/// field6（mode:reg）をデコードし、消費する追加ワード数も返す。
fn decode_field6(
    field6: u16,
    pc_byte: u16,
    extra_index: u8,
    read_word: &impl Fn(u16) -> u16,
) -> (DecodedOp, u8) {
    let mode = (field6 >> 4) & 3;
    let reg = field6 & 0xf;
    match mode {
        0 => (DecodedOp::Reg(reg), 0),
        1 => (DecodedOp::Indirect(reg), 0),
        3 => (DecodedOp::AutoInc(reg), 0),
        _ => {
            let addr = read_at_byte(pc_byte.wrapping_add((extra_index as u16) * 2), read_word);
            if reg == 0 {
                (DecodedOp::Sym(addr), 1)
            } else {
                (
                    DecodedOp::Indexed {
                        addr,
                        reg,
                    },
                    1,
                )
            }
        }
    }
}

fn decode_single_operand(
    mnemonic: &str,
    ir: u16,
    pc_byte: u16,
    read_word: &impl Fn(u16) -> u16,
) -> DecodedInst {
    let field6 = ir & 0x3f;
    let (op, extra) = decode_field6(field6, pc_byte, 1, read_word);
    with_words(mnemonic, ir, vec![op], 1 + extra)
}

fn decode_fmt1(
    mnemonic: &str,
    ir: u16,
    pc_byte: u16,
    read_word: &impl Fn(u16) -> u16,
) -> DecodedInst {
    let src_field = ir & 0x3f;
    let dst_field = (ir >> 6) & 0x3f;
    let (src, src_extra) = decode_field6(src_field, pc_byte, 1, read_word);
    let dst_index = 1 + src_extra;
    let (dst, dst_extra) = decode_field6(dst_field, pc_byte, dst_index, read_word);
    with_words(
        mnemonic,
        ir,
        vec![src, dst],
        1 + src_extra + dst_extra,
    )
}

fn decode_fmt3(
    mnemonic: &str,
    ir: u16,
    pc_byte: u16,
    read_word: &impl Fn(u16) -> u16,
) -> DecodedInst {
    let reg = (ir >> 6) & 0xf;
    let field6 = ir & 0x3f;
    let (src, extra) = decode_field6(field6, pc_byte, 1, read_word);
    with_words(
        mnemonic,
        ir,
        vec![src, DecodedOp::Reg(reg)],
        1 + extra,
    )
}

fn decode_fmt4(
    mnemonic: &str,
    ir: u16,
    pc_byte: u16,
    read_word: &impl Fn(u16) -> u16,
) -> DecodedInst {
    let bits_raw = (ir >> 6) & 0xf;
    let bits = if bits_raw == 0 { 16 } else { bits_raw as u8 };
    let field6 = ir & 0x3f;
    let (src, extra) = decode_field6(field6, pc_byte, 1, read_word);
    with_words(
        mnemonic,
        ir,
        vec![src, DecodedOp::ImmCount(bits)],
        1 + extra,
    )
}

fn decode_fmt9_mpy_div(
    mnemonic: &str,
    ir: u16,
    pc_byte: u16,
    read_word: &impl Fn(u16) -> u16,
) -> DecodedInst {
    let reg = (ir >> 6) & 0xf;
    let field6 = ir & 0x3f;
    let (src, extra) = decode_field6(field6, pc_byte, 1, read_word);
    with_words(
        mnemonic,
        ir,
        vec![src, DecodedOp::Reg(reg)],
        1 + extra,
    )
}

fn decode_xop(ir: u16, pc_byte: u16, read_word: &impl Fn(u16) -> u16) -> DecodedInst {
    let n = ((ir >> 6) & 0xf) as u8;
    let field6 = ir & 0x3f;
    let (src, extra) = decode_field6(field6, pc_byte, 1, read_word);
    with_words(
        "XOP",
        ir,
        vec![src, DecodedOp::XopNum(n)],
        1 + extra,
    )
}

fn jump_target(pc_byte: u16, ir: u16) -> u16 {
    let disp = ir as i8 as i32;
    let next_pc = (pc_byte as i32) + 2;
    (next_pc + disp * 2) as u16 & 0xffff
}

fn fmt6_mnemonic(ir: u16) -> Option<&'static str> {
    match ir & 0xffc0 {
        0x0180 => Some("DIVS"),
        0x01c0 => Some("MPYS"),
        0x0400 => Some("BLWP"),
        0x0440 => Some("B"),
        0x0480 => Some("X"),
        0x04c0 => Some("CLR"),
        0x0500 => Some("NEG"),
        0x0540 => Some("INV"),
        0x0580 => Some("INC"),
        0x05c0 => Some("INCT"),
        0x0600 => Some("DEC"),
        0x0640 => Some("DECT"),
        0x0680 => Some("BL"),
        0x06c0 => Some("SWPB"),
        0x0700 => Some("SETO"),
        0x0740 => Some("ABS"),
        _ => None,
    }
}

fn fmt8_reg_imm(ir: u16) -> Option<(&'static str, u16)> {
    match ir & 0xfff0 {
        0x0200 => Some(("LI", 0x0200)),
        0x0220 => Some(("AI", 0x0220)),
        0x0240 => Some(("ANDI", 0x0240)),
        0x0260 => Some(("ORI", 0x0260)),
        0x0280 => Some(("CI", 0x0280)),
        _ => None,
    }
}

/// 指定バイトアドレス（偶数）の 1 命令をデコードする。
pub fn decode_tms9995(byte_addr: u16, read_word: &impl Fn(u16) -> u16) -> DecodedInst {
    let pc = byte_addr & 0xfffe;
    let ir = read_at_byte(pc, read_word);

    if ir == 0 {
        return undef(ir);
    }

    // Format 7 — fixed
    match ir {
        0x0340 => return fixed("IDLE", ir),
        0x0360 => return fixed("RSET", ir),
        0x0380 => return fixed("RTWP", ir),
        0x03a0 => return fixed("CKON", ir),
        0x03c0 => return fixed("CKOF", ir),
        0x03e0 => return fixed("LREX", ir),
        _ => {}
    }

    // Format 8 — LST / LWP / STWP / STST
    match ir & 0xfff0 {
        0x0080 => return one("LST", ir, DecodedOp::Reg(ir & 0xf)),
        0x0090 => return one("LWP", ir, DecodedOp::Reg(ir & 0xf)),
        0x02a0 => return one("STWP", ir, DecodedOp::Reg(ir & 0xf)),
        0x02c0 => return one("STST", ir, DecodedOp::Reg(ir & 0xf)),
        _ => {}
    }

    // Format 8 — LI / AI / … + imm
    if let Some((mnemonic, _)) = fmt8_reg_imm(ir) {
        let reg = ir & 0xf;
        let imm = read_at_byte(pc.wrapping_add(2), read_word);
        return with_words(
            mnemonic,
            ir,
            vec![DecodedOp::Reg(reg), DecodedOp::Imm(imm)],
            2,
        );
    }

    // LWPI / LIMI
    match ir {
        0x02e0 => {
            let imm = read_at_byte(pc.wrapping_add(2), read_word);
            return with_words("LWPI", ir, vec![DecodedOp::Imm(imm)], 2);
        }
        0x0300 => {
            let imm = read_at_byte(pc.wrapping_add(2), read_word);
            return with_words("LIMI", ir, vec![DecodedOp::Imm(imm)], 2);
        }
        _ => {}
    }

    // Format 5 — shifts
    match ir & 0xff00 {
        0x0800 | 0x0900 | 0x0a00 | 0x0b00 => {
            let mnemonic = match ir & 0xff00 {
                0x0800 => "SRA",
                0x0900 => "SRL",
                0x0a00 => "SLA",
                _ => "SRC",
            };
            let reg = ir & 0xf;
            let count = ((ir >> 4) & 0xf) as u8;
            return two(
                mnemonic,
                ir,
                DecodedOp::Reg(reg),
                DecodedOp::ImmCount(count),
            );
        }
        _ => {}
    }

    // Format 6 — single operand
    if let Some(mnemonic) = fmt6_mnemonic(ir) {
        return decode_single_operand(mnemonic, ir, pc, read_word);
    }

    // Format 2 — jumps / CRU
    if (ir & 0xf000) == 0x1000 {
        let cond = (ir >> 8) & 0xf;
        match cond {
            0x0 => {
                let tgt = jump_target(pc, ir);
                return one("JMP", ir, DecodedOp::JumpTarget(tgt));
            }
            0x1 => return one("JLT", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x2 => return one("JLE", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x3 => return one("JEQ", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x4 => return one("JHE", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x5 => return one("JGT", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x6 => return one("JNE", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x7 => return one("JNC", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x8 => return one("JOC", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0x9 => return one("JNO", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0xa => return one("JL", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0xb => return one("JH", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0xc => return one("JOP", ir, DecodedOp::JumpTarget(jump_target(pc, ir))),
            0xd => {
                let disp = ir as i8;
                return one("SBO", ir, DecodedOp::ImmDisp(disp));
            }
            0xe => {
                let disp = ir as i8;
                return one("SBZ", ir, DecodedOp::ImmDisp(disp));
            }
            0xf => {
                let disp = ir as i8;
                return one("TB", ir, DecodedOp::ImmDisp(disp));
            }
            _ => {}
        }
    }

    // Format 3
    match ir & 0xfc00 {
        0x2000 => return decode_fmt3("COC", ir, pc, read_word),
        0x2400 => return decode_fmt3("CZC", ir, pc, read_word),
        0x2800 => return decode_fmt3("XOR", ir, pc, read_word),
        _ => {}
    }

    // Format 4
    match ir & 0xfc00 {
        0x3000 => return decode_fmt4("LDCR", ir, pc, read_word),
        0x3400 => return decode_fmt4("STCR", ir, pc, read_word),
        _ => {}
    }

    // Format 9
    match ir & 0xfc00 {
        0x2c00 => return decode_xop(ir, pc, read_word),
        0x3800 => return decode_fmt9_mpy_div("MPY", ir, pc, read_word),
        0x3c00 => return decode_fmt9_mpy_div("DIV", ir, pc, read_word),
        _ => {}
    }

    // Format 1
    match ir & 0xf000 {
        0x4000 => return decode_fmt1("SZC", ir, pc, read_word),
        0x5000 => return decode_fmt1("SZCB", ir, pc, read_word),
        0x6000 => return decode_fmt1("S", ir, pc, read_word),
        0x7000 => return decode_fmt1("SB", ir, pc, read_word),
        0x8000 => return decode_fmt1("C", ir, pc, read_word),
        0x9000 => return decode_fmt1("CB", ir, pc, read_word),
        0xa000 => return decode_fmt1("A", ir, pc, read_word),
        0xb000 => return decode_fmt1("AB", ir, pc, read_word),
        0xc000 => return decode_fmt1("MOV", ir, pc, read_word),
        0xd000 => return decode_fmt1("MOVB", ir, pc, read_word),
        0xe000 => return decode_fmt1("SOC", ir, pc, read_word),
        0xf000 => return decode_fmt1("SOCB", ir, pc, read_word),
        _ => {}
    }

    undef(ir)
}
