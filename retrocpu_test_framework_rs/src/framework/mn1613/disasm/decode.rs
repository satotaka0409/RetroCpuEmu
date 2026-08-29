//! MN1613 1 命令デコード（構造化オペランド）。
//!
//! 根拠: MN1613.mdc オペコード表 / mn1613.ts の実行デコード

use super::format::hex8;

/// アドレス表示の形（ラベル解決は format 側）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddrForm {
    Plain,
    Zp,
    Paren,
    At,
    StarParen,
    Io,
    Bb,
}

/// デコード済みオペランド。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodedOp {
    Raw(String),
    Addr {
        v: u16,
        form: AddrForm,
        bb: Option<String>,
    },
    Imm {
        v: u16,
        bits: u8,
    },
    Skip(u8),
    Ee(u8),
    C,
}

/// 1 命令のデコード結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedInst {
    pub mnemonic: String,
    pub ops: Vec<DecodedOp>,
    pub word_count: u8,
    pub ir: u16,
}

const REGS: [&str; 8] = ["R0", "R1", "R2", "R3", "R4", "SP", "STR", "IC"];
const RI: [&str; 4] = ["R1", "R2", "R3", "R4"];
const BB: [&str; 4] = ["CSBR", "SSBR", "TSR0", "TSR1"];
const BBB: [&str; 8] = ["CSBR", "SSBR", "TSR0", "TSR1", "OSR0", "OSR1", "OSR2", "OSR3"];
const PPP: [&str; 3] = ["SBRB", "ICB", "NPP"];
const HHH: [&str; 7] = ["TCR", "TIR", "TSR", "SCR", "SSR", "SOR", "IISR"];

/// 汎用レジスタ名（rrr 0–7 → R0–R4 / SP / STR / IC）。
pub fn reg_name(rrr: u16) -> &'static str {
    REGS[(rrr & 7) as usize]
}

/// 間接レジスタ名（ii 0–3 → R1–R4）。
pub fn ri_name(ii: u16) -> &'static str {
    RI[(ii & 3) as usize]
}

/// 符号付き 8bit 相対のターゲット（基準は当該命令自身のワードアドレス）。
pub fn rel_target(instr_addr: u16, d: u16) -> u16 {
    let sd = if d < 0x80 { d as i16 } else { (d as i16) - 0x100 };
    instr_addr.wrapping_add(sd as u16) & 0xffff
}

fn undef(ir: u16) -> DecodedInst {
    DecodedInst {
        mnemonic: ".word".into(),
        ops: vec![DecodedOp::Imm {
            v: ir & 0xffff,
            bits: 16,
        }],
        word_count: 1,
        ir,
    }
}

fn ri_mode(mm: u16, ii: u16) -> Option<String> {
    let r = ri_name(ii);
    match mm {
        1 => Some(format!("({r})")),
        2 => Some(format!("-({r})")),
        3 => Some(format!("({r})+")),
        _ => None,
    }
}

fn trail(ops: Vec<DecodedOp>, skip: u16, ee: Option<u16>, carry: bool) -> Vec<DecodedOp> {
    let mut out = ops;
    if carry {
        out.push(DecodedOp::C);
    }
    if let Some(ee) = ee {
        if (ee & 3) != 0 {
            out.push(DecodedOp::Ee((ee & 3) as u8));
        }
    }
    if (skip & 0xf) != 0 {
        out.push(DecodedOp::Skip((skip & 0xf) as u8));
    }
    out
}

fn one(mnemonic: &str, ir: u16, ops: Vec<DecodedOp>) -> DecodedInst {
    DecodedInst {
        mnemonic: mnemonic.to_string(),
        ops,
        word_count: 1,
        ir,
    }
}

fn two(mnemonic: &str, ir: u16, ops: Vec<DecodedOp>) -> DecodedInst {
    DecodedInst {
        mnemonic: mnemonic.to_string(),
        ops,
        word_count: 2,
        ir,
    }
}

fn ea_op(mmm: u16, d: u16, instr_addr: u16) -> DecodedOp {
    let disp = d & 0xff;
    match mmm & 7 {
        0 => DecodedOp::Addr {
            v: disp,
            form: AddrForm::Zp,
            bb: None,
        },
        1 => DecodedOp::Addr {
            v: rel_target(instr_addr, disp),
            form: AddrForm::Plain,
            bb: None,
        },
        2 => DecodedOp::Addr {
            v: disp,
            form: AddrForm::StarParen,
            bb: None,
        },
        3 => DecodedOp::Addr {
            v: rel_target(instr_addr, disp),
            form: AddrForm::Paren,
            bb: None,
        },
        4 => DecodedOp::Raw(format!("{}(X0)", hex8(disp))),
        5 => DecodedOp::Raw(format!("{}(X1)", hex8(disp))),
        6 => DecodedOp::Raw(format!("(*{})(X0)", hex8(disp))),
        _ => DecodedOp::Raw(format!("(*{})(X1)", hex8(disp))),
    }
}

/// 指定ワードアドレスの 1 命令をデコードする。
pub fn decode_mn1613(addr: u16, read_word: &dyn Fn(u16) -> u16) -> DecodedInst {
    let a = addr & 0xffff;
    let ir = read_word(a) & 0xffff;
    let extra = || read_word(a.wrapping_add(1)) & 0xffff;
    let op = (ir >> 11) & 0x1f;
    let rrr = (ir >> 8) & 7;
    let lo = ir & 0xff;
    let kkkk = (lo >> 4) & 0xf;
    let b32 = (lo >> 2) & 3;
    let b10 = lo & 3;

    if op >= 0x10 {
        let mmm = op & 7;
        let is_hi = (op & 8) != 0;
        let ea = ea_op(mmm, lo, a);
        if rrr == 7 {
            let mnem = if is_hi { "B" } else { "BAL" };
            return one(mnem, ir, vec![ea]);
        }
        if rrr == 6 {
            let mnem = if is_hi { "IMS" } else { "DMS" };
            return one(mnem, ir, vec![ea]);
        }
        let mnem = if is_hi { "L" } else { "ST" };
        return one(
            mnem,
            ir,
            vec![DecodedOp::Raw(reg_name(rrr).to_string()), ea],
        );
    }

    match op {
        0x00 => undef(ir),
        0x01 => decode01(ir, rrr, lo, &extra),
        0x02 => decode02(ir, rrr, lo, kkkk, &extra),
        0x03 => decode03(ir, rrr, lo, kkkk),
        0x04 => decode04(ir, rrr, lo, kkkk, b32, &extra),
        0x05 => one(
            "TBIT",
            ir,
            trail(
                vec![
                    DecodedOp::Raw(reg_name(rrr).to_string()),
                    DecodedOp::Imm {
                        v: lo & 0xf,
                        bits: 4,
                    },
                ],
                kkkk,
                None,
                false,
            ),
        ),
        0x06 => one(
            "RBIT",
            ir,
            trail(
                vec![
                    DecodedOp::Raw(reg_name(rrr).to_string()),
                    DecodedOp::Imm {
                        v: lo & 0xf,
                        bits: 4,
                    },
                ],
                kkkk,
                None,
                false,
            ),
        ),
        0x07 => decode07(ir, rrr, lo, kkkk),
        0x08 => decode08(ir, rrr, lo, kkkk, b10),
        0x09 => decode09(ir, rrr, lo, kkkk, b10),
        0x0a => decode0a(ir, rrr, lo, kkkk, &extra),
        0x0b => decode0b(ir, rrr, lo, kkkk, &extra),
        0x0c => decode0c(ir, rrr, lo, kkkk, &extra),
        0x0d => decode0d(ir, rrr, lo, kkkk, &extra),
        0x0e => decode0e(ir, rrr, lo, kkkk),
        0x0f => decode0f(ir, rrr, lo, kkkk, &extra),
        _ => undef(ir),
    }
}

fn decode01(ir: u16, rrr: u16, lo: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    if rrr != 7 {
        return one(
            "MVI",
            ir,
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Imm { v: lo, bits: 8 },
            ],
        );
    }
    let bit7 = (lo >> 7) & 1;
    let b_bits = (lo >> 4) & 7;
    let bit3 = (lo >> 3) & 1;
    let b_lo = lo & 7;
    if b_lo == 7 {
        let ad = extra();
        let addr = DecodedOp::Addr {
            v: ad,
            form: AddrForm::Plain,
            bb: None,
        };
        if bit7 == 0 && bit3 == 0 {
            return two(
                "LB",
                ir,
                vec![
                    DecodedOp::Raw(BBB[b_bits as usize].to_string()),
                    addr,
                ],
            );
        }
        if bit7 == 0 && bit3 == 1 {
            let Some(sr) = PPP.get(b_bits as usize) else {
                return undef(ir);
            };
            return two(
                "LS",
                ir,
                vec![DecodedOp::Raw(sr.to_string()), addr],
            );
        }
        if bit7 == 1 && bit3 == 0 {
            return two(
                "STB",
                ir,
                vec![
                    DecodedOp::Raw(BBB[b_bits as usize].to_string()),
                    addr,
                ],
            );
        }
        let Some(sr) = PPP.get(b_bits as usize) else {
            return undef(ir);
        };
        return two(
            "STS",
            ir,
            vec![DecodedOp::Raw(sr.to_string()), addr],
        );
    }
    if bit7 == 1 && bit3 == 0 {
        return one(
            "CPYB",
            ir,
            vec![
                DecodedOp::Raw(reg_name(b_lo).to_string()),
                DecodedOp::Raw(BBB[b_bits as usize].to_string()),
            ],
        );
    }
    if bit7 == 1 && bit3 == 1 {
        let Some(sr) = PPP.get(b_bits as usize) else {
            return undef(ir);
        };
        return one(
            "CPYS",
            ir,
            vec![
                DecodedOp::Raw(reg_name(b_lo).to_string()),
                DecodedOp::Raw(sr.to_string()),
            ],
        );
    }
    if bit7 == 0 && bit3 == 0 {
        return one(
            "SETB",
            ir,
            vec![
                DecodedOp::Raw(reg_name(b_lo).to_string()),
                DecodedOp::Raw(BBB[b_bits as usize].to_string()),
            ],
        );
    }
    let Some(sr) = PPP.get(b_bits as usize) else {
        return undef(ir);
    };
    one(
        "SETS",
        ir,
        vec![
            DecodedOp::Raw(reg_name(b_lo).to_string()),
            DecodedOp::Raw(sr.to_string()),
        ],
    )
}

fn decode02(ir: u16, rrr: u16, lo: u16, kkkk: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    if rrr != 7 {
        return one(
            "WT",
            ir,
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Addr {
                    v: lo,
                    form: AddrForm::Io,
                    bb: None,
                },
            ],
        );
    }
    if lo == 0x0f {
        return one("PSHM", ir, vec![]);
    }
    if lo == 0x07 {
        return one("POPM", ir, vec![]);
    }
    let ad = extra();
    let sss = lo & 7;
    let mnem = if (lo & 8) != 0 { "TSET" } else { "TRST" };
    two(
        mnem,
        ir,
        trail(
            vec![
                DecodedOp::Raw(reg_name(sss).to_string()),
                DecodedOp::Addr {
                    v: ad,
                    form: AddrForm::Plain,
                    bb: None,
                },
            ],
            kkkk,
            None,
            false,
        ),
    )
}

fn decode03(ir: u16, rrr: u16, lo: u16, kkkk: u16) -> DecodedInst {
    if rrr != 7 {
        return one(
            "RD",
            ir,
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Addr {
                    v: lo,
                    form: AddrForm::Io,
                    bb: None,
                },
            ],
        );
    }
    let bit3 = (lo >> 3) & 1;
    let bit2 = (lo >> 2) & 1;
    if bit2 == 1 {
        if bit3 == 0 {
            return one(
                "FIX",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("R0".into()),
                        DecodedOp::Raw("DR0".into()),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        return one(
            "FLT",
            ir,
            trail(
                vec![
                    DecodedOp::Raw("DR0".into()),
                    DecodedOp::Raw("R0".into()),
                ],
                kkkk,
                None,
                false,
            ),
        );
    }
    let ddd = lo & 7;
    one(
        "NEG",
        ir,
        trail(
            vec![DecodedOp::Raw(reg_name(ddd).to_string())],
            kkkk,
            None,
            bit3 == 0,
        ),
    )
}

fn decode04(
    ir: u16,
    rrr: u16,
    lo: u16,
    kkkk: u16,
    b32: u16,
    extra: &dyn Fn() -> u16,
) -> DecodedInst {
    let b76 = (lo >> 6) & 3;
    let b54 = (lo >> 4) & 3;
    let b10 = lo & 3;
    let ee = b10;

    if rrr == 0 {
        if lo == 0x00 {
            return one("H", ir, vec![]);
        }
        if lo == 0x03 {
            return one("RET", ir, vec![]);
        }
        if (0x04..=0x07).contains(&lo) {
            return one(
                "LPSW",
                ir,
                vec![DecodedOp::Raw((lo & 3).to_string())],
            );
        }
    }

    if rrr == 6 {
        if lo == 0x07 {
            let ad = extra();
            return two(
                "BD",
                ir,
                vec![DecodedOp::Addr {
                    v: ad,
                    form: AddrForm::Plain,
                    bb: None,
                }],
            );
        }
        if lo == 0x17 {
            let ad = extra();
            return two(
                "BALD",
                ir,
                vec![DecodedOp::Addr {
                    v: ad,
                    form: AddrForm::Plain,
                    bb: None,
                }],
            );
        }
    }

    if rrr == 7 {
        if (lo & 0xfc) == 0x04 {
            return one(
                "BR",
                ir,
                vec![DecodedOp::Raw(format!("@({})", ri_name(b10)))],
            );
        }
        if (lo & 0xfc) == 0x14 {
            return one(
                "BALR",
                ir,
                vec![DecodedOp::Raw(format!("@({})", ri_name(b10)))],
            );
        }
        if (lo & 0x08) != 0 {
            let dest = lo & 7;
            let ad = extra();
            if (lo & 0x40) == 0 {
                if dest == 7 {
                    let mnem = if b54 == 1 { "BALL" } else { "BL" };
                    return two(
                        mnem,
                        ir,
                        vec![DecodedOp::Addr {
                            v: ad,
                            form: AddrForm::At,
                            bb: None,
                        }],
                    );
                }
                let mut ops = vec![DecodedOp::Raw(reg_name(dest).to_string())];
                if b54 == 0 {
                    ops.push(DecodedOp::Addr {
                        v: ad,
                        form: AddrForm::Plain,
                        bb: None,
                    });
                } else {
                    ops.push(DecodedOp::Addr {
                        v: ad,
                        form: AddrForm::Bb,
                        bb: Some(BB[b54 as usize].to_string()),
                    });
                }
                return two("LD", ir, ops);
            }
            let mut ops = vec![DecodedOp::Raw(reg_name(dest).to_string())];
            if b54 == 0 {
                ops.push(DecodedOp::Addr {
                    v: ad,
                    form: AddrForm::Plain,
                    bb: None,
                });
            } else {
                ops.push(DecodedOp::Addr {
                    v: ad,
                    form: AddrForm::Bb,
                    bb: Some(BB[b54 as usize].to_string()),
                });
            }
            return two("STD", ir, ops);
        }
    }

    if lo == 0x01 {
        return one(
            "PUSH",
            ir,
            vec![DecodedOp::Raw(reg_name(rrr).to_string())],
        );
    }
    if lo == 0x02 {
        return one(
            "POP",
            ir,
            vec![DecodedOp::Raw(reg_name(rrr).to_string())],
        );
    }

    if let Some(mm_str) = ri_mode(b76, b10) {
        if b32 == 0 {
            let mut ops = vec![DecodedOp::Raw(reg_name(rrr).to_string())];
            if b54 != 0 {
                ops.push(DecodedOp::Raw(BB[b54 as usize].to_string()));
            }
            ops.push(DecodedOp::Raw(mm_str));
            return one("LR", ir, ops);
        }
        if b32 == 1 {
            let mut ops = vec![DecodedOp::Raw(reg_name(rrr).to_string())];
            if b54 != 0 {
                ops.push(DecodedOp::Raw(BB[b54 as usize].to_string()));
            }
            ops.push(DecodedOp::Raw(mm_str));
            return one("STR", ir, ops);
        }
    }

    if b32 == 2 {
        return one(
            "SR",
            ir,
            trail(
                vec![DecodedOp::Raw(reg_name(rrr).to_string())],
                kkkk,
                Some(ee),
                false,
            ),
        );
    }
    if b32 == 3 {
        return one(
            "SL",
            ir,
            trail(
                vec![DecodedOp::Raw(reg_name(rrr).to_string())],
                kkkk,
                Some(ee),
                false,
            ),
        );
    }

    if lo >> 4 == 1 && b32 == 1 && rrr != 7 {
        return one(
            "RDR",
            ir,
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Raw(format!("({})", ri_name(b10))),
            ],
        );
    }
    if lo >> 4 == 1 && b32 == 0 {
        return one(
            "WTR",
            ir,
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Raw(format!("({})", ri_name(b10))),
            ],
        );
    }

    undef(ir)
}

fn decode07(ir: u16, rrr: u16, lo: u16, kkkk: u16) -> DecodedInst {
    if rrr != 7 {
        return one(
            "SBIT",
            ir,
            trail(
                vec![
                    DecodedOp::Raw(reg_name(rrr).to_string()),
                    DecodedOp::Imm {
                        v: lo & 0xf,
                        bits: 4,
                    },
                ],
                kkkk,
                None,
                false,
            ),
        );
    }
    if lo == 0x07 {
        return one("RETL", ir, vec![]);
    }
    if lo == 0x17 {
        return one("BLK", ir, vec![]);
    }
    if lo >> 4 == 0x7 && (lo & 8) == 0 {
        return one(
            "SRBT",
            ir,
            vec![
                DecodedOp::Raw("R0".into()),
                DecodedOp::Raw(reg_name(lo & 7).to_string()),
            ],
        );
    }
    if lo >> 4 == 0xf && (lo & 8) == 0 {
        return one(
            "DEBP",
            ir,
            vec![
                DecodedOp::Raw(reg_name(lo & 7).to_string()),
                DecodedOp::Raw("R0".into()),
            ],
        );
    }
    if (lo & 8) != 0 {
        return undef(ir);
    }
    let bit7 = (lo >> 7) & 1;
    let hhh = (lo >> 4) & 7;
    let Some(hr) = HHH.get(hhh as usize) else {
        return undef(ir);
    };
    let rd = reg_name(lo & 7);
    if bit7 == 1 {
        return one(
            "CPYH",
            ir,
            vec![
                DecodedOp::Raw(rd.to_string()),
                DecodedOp::Raw(hr.to_string()),
            ],
        );
    }
    one(
        "SETH",
        ir,
        vec![
            DecodedOp::Raw(rd.to_string()),
            DecodedOp::Raw(hr.to_string()),
        ],
    )
}

fn decode08(ir: u16, rrr: u16, lo: u16, kkkk: u16, b10: u16) -> DecodedInst {
    if rrr == 7 && (lo & 4) != 0 {
        let c = (lo >> 3) & 1;
        return one(
            "SD",
            ir,
            trail(
                vec![
                    DecodedOp::Raw("DR0".into()),
                    DecodedOp::Raw(format!("({})", ri_name(b10))),
                ],
                kkkk,
                None,
                c == 0,
            ),
        );
    }
    one(
        "SI",
        ir,
        trail(
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Imm {
                    v: lo & 0xf,
                    bits: 4,
                },
            ],
            kkkk,
            None,
            false,
        ),
    )
}

fn decode09(ir: u16, rrr: u16, lo: u16, kkkk: u16, b10: u16) -> DecodedInst {
    if rrr == 7 && (lo & 4) != 0 {
        let c = (lo >> 3) & 1;
        return one(
            "AD",
            ir,
            trail(
                vec![
                    DecodedOp::Raw("DR0".into()),
                    DecodedOp::Raw(format!("({})", ri_name(b10))),
                ],
                kkkk,
                None,
                c == 0,
            ),
        );
    }
    one(
        "AI",
        ir,
        trail(
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Imm {
                    v: lo & 0xf,
                    bits: 4,
                },
            ],
            kkkk,
            None,
            false,
        ),
    )
}

struct RegFamilySpec<'a> {
    when7: [&'a str; 4],
    imm_hi: &'a str,
    imm_lo: &'a str,
    bit1: &'a str,
    bit0: &'a str,
    acc7: &'a str,
}

fn decode_reg_family(
    ir: u16,
    rrr: u16,
    lo: u16,
    kkkk: u16,
    extra: &dyn Fn() -> u16,
    spec: RegFamilySpec<'_>,
) -> DecodedInst {
    let b32 = (lo >> 2) & 3;
    let b10 = lo & 3;
    let tail = lo & 0xf;
    if rrr == 7 {
        let mnem = spec.when7[b32 as usize];
        if mnem.is_empty() {
            return undef(ir);
        }
        return one(
            mnem,
            ir,
            trail(
                vec![
                    DecodedOp::Raw(spec.acc7.to_string()),
                    DecodedOp::Raw(format!("({})", ri_name(b10))),
                ],
                kkkk,
                None,
                false,
            ),
        );
    }
    if tail == 0x0f {
        let im = extra();
        return two(
            spec.imm_hi,
            ir,
            trail(
                vec![
                    DecodedOp::Raw(reg_name(rrr).to_string()),
                    DecodedOp::Imm { v: im, bits: 16 },
                ],
                kkkk,
                None,
                false,
            ),
        );
    }
    if tail == 0x07 {
        let im = extra();
        return two(
            spec.imm_lo,
            ir,
            trail(
                vec![
                    DecodedOp::Raw(reg_name(rrr).to_string()),
                    DecodedOp::Imm { v: im, bits: 16 },
                ],
                kkkk,
                None,
                false,
            ),
        );
    }
    let sss = lo & 7;
    let mnem = if (lo & 8) != 0 {
        spec.bit1
    } else {
        spec.bit0
    };
    one(
        mnem,
        ir,
        trail(
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Raw(reg_name(sss).to_string()),
            ],
            kkkk,
            None,
            false,
        ),
    )
}

fn decode0a(ir: u16, rrr: u16, lo: u16, kkkk: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    if rrr == 7 && (lo & 4) != 0 {
        let c = (lo >> 3) & 1;
        return one(
            "DAS",
            ir,
            trail(
                vec![
                    DecodedOp::Raw("R0".into()),
                    DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                ],
                kkkk,
                None,
                c == 0,
            ),
        );
    }
    decode_reg_family(
        ir,
        rrr,
        lo,
        kkkk,
        extra,
        RegFamilySpec {
            when7: ["CBR", "", "CWR", ""],
            imm_hi: "CWI",
            imm_lo: "CBI",
            bit1: "C",
            bit0: "CB",
            acc7: "R0",
        },
    )
}

fn decode0b(ir: u16, rrr: u16, lo: u16, kkkk: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    if rrr == 7 && (lo & 4) != 0 {
        let c = (lo >> 3) & 1;
        return one(
            "DAA",
            ir,
            trail(
                vec![
                    DecodedOp::Raw("R0".into()),
                    DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                ],
                kkkk,
                None,
                c == 0,
            ),
        );
    }
    decode_reg_family(
        ir,
        rrr,
        lo,
        kkkk,
        extra,
        RegFamilySpec {
            when7: ["SWR", "", "AWR", ""],
            imm_hi: "AWI",
            imm_lo: "SWI",
            bit1: "A",
            bit0: "S",
            acc7: "R0",
        },
    )
}

fn decode0c(ir: u16, rrr: u16, lo: u16, kkkk: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    let b32 = (lo >> 2) & 3;
    let acc7 = if b32 == 1 || b32 == 3 { "DR0" } else { "R0" };
    decode_reg_family(
        ir,
        rrr,
        lo,
        kkkk,
        extra,
        RegFamilySpec {
            when7: ["EORR", "FD", "ORR", "FM"],
            imm_hi: "ORI",
            imm_lo: "EORI",
            bit1: "OR",
            bit0: "EOR",
            acc7,
        },
    )
}

fn decode0d(ir: u16, rrr: u16, lo: u16, kkkk: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    let b32 = (lo >> 2) & 3;
    let acc7 = if b32 == 1 || b32 == 3 { "DR0" } else { "R0" };
    decode_reg_family(
        ir,
        rrr,
        lo,
        kkkk,
        extra,
        RegFamilySpec {
            when7: ["LADR", "FS", "ANDR", "FA"],
            imm_hi: "ANDI",
            imm_lo: "LADI",
            bit1: "AND",
            bit0: "LAD",
            acc7,
        },
    )
}

fn decode0e(ir: u16, rrr: u16, lo: u16, kkkk: u16) -> DecodedInst {
    let b32 = (lo >> 2) & 3;
    if rrr == 7 {
        if b32 == 3 {
            return one(
                "D",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("DR0".into()),
                        DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        if b32 == 2 {
            return one(
                "BSWR",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("R0".into()),
                        DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        if b32 == 0 {
            return one(
                "DSWR",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("R0".into()),
                        DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        return undef(ir);
    }
    let sss = lo & 7;
    if (lo & 0xf) == 0x07 || (lo & 0xf) == 0x0f {
        return undef(ir);
    }
    let mnem = if (lo & 8) != 0 { "BSWP" } else { "DSWP" };
    one(
        mnem,
        ir,
        trail(
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Raw(reg_name(sss).to_string()),
            ],
            kkkk,
            None,
            false,
        ),
    )
}

fn decode0f(ir: u16, rrr: u16, lo: u16, kkkk: u16, extra: &dyn Fn() -> u16) -> DecodedInst {
    let b32 = (lo >> 2) & 3;
    let tail = lo & 0xf;
    if rrr != 7 && tail == 0x07 {
        let im = extra();
        return two(
            "MVWI",
            ir,
            trail(
                vec![
                    DecodedOp::Raw(reg_name(rrr).to_string()),
                    DecodedOp::Imm { v: im, bits: 16 },
                ],
                kkkk,
                None,
                false,
            ),
        );
    }
    if rrr == 7 {
        if b32 == 3 {
            return one(
                "M",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("DR0".into()),
                        DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        if b32 == 2 {
            return one(
                "MVWR",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("R0".into()),
                        DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        if b32 == 0 {
            return one(
                "MVBR",
                ir,
                trail(
                    vec![
                        DecodedOp::Raw("R0".into()),
                        DecodedOp::Raw(format!("({})", ri_name(lo & 3))),
                    ],
                    kkkk,
                    None,
                    false,
                ),
            );
        }
        return undef(ir);
    }
    let sss = lo & 7;
    let mnem = if (lo & 8) != 0 { "MV" } else { "MVB" };
    one(
        mnem,
        ir,
        trail(
            vec![
                DecodedOp::Raw(reg_name(rrr).to_string()),
                DecodedOp::Raw(reg_name(sss).to_string()),
            ],
            kkkk,
            None,
            false,
        ),
    )
}
