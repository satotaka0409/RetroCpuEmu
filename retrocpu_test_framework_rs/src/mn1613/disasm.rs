//! MN1613 逆アセンブラ（テストログ用の最小実装）。
//!
//! 根拠: `retrocpu_emu_ts/src/dis_assembler/mn1613/` / asm_test_framework.mdc

const REGS: [&str; 8] = ["R0", "R1", "R2", "R3", "R4", "SP", "STR", "IC"];
const RI: [&str; 4] = ["R1", "R2", "R3", "R4"];

/// 1 命令の逆アセンブル結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisasmResult {
    /// 表示文字列（例: `A R0, R1`）
    pub text: String,
    /// 消費ワード数（1 または 2）
    pub word_count: u8,
}

fn reg_name(rrr: u16) -> &'static str {
    REGS[(rrr & 7) as usize]
}

fn ri_name(ii: u16) -> &'static str {
    RI[(ii & 3) as usize]
}

fn hex16(v: u16) -> String {
    format!("0x{:04X}", v & 0xffff)
}

fn undef(ir: u16) -> DisasmResult {
    DisasmResult {
        text: format!(".word {}", hex16(ir)),
        word_count: 1,
    }
}

fn decode04(ir: u16, rrr: u16, lo: u16, extra: u16) -> DisasmResult {
    if rrr == 0 {
        if lo == 0x00 {
            return DisasmResult {
                text: "H".into(),
                word_count: 1,
            };
        }
        if lo == 0x03 {
            return DisasmResult {
                text: "RET".into(),
                word_count: 1,
            };
        }
        if (0x04..=0x07).contains(&lo) {
            return DisasmResult {
                text: format!("LPSW {}", lo & 3),
                word_count: 1,
            };
        }
    }
    if rrr == 6 {
        if lo == 0x07 {
            return DisasmResult {
                text: format!("BD {}", hex16(extra)),
                word_count: 2,
            };
        }
        if lo == 0x17 {
            return DisasmResult {
                text: format!("BALD {}", hex16(extra)),
                word_count: 2,
            };
        }
    }
    undef(ir)
}

fn decode_reg_family(
    ir: u16,
    rrr: u16,
    lo: u16,
    extra: u16,
    bit1: &str,
    bit0: &str,
) -> DisasmResult {
    let tail = lo & 0x0f;
    if rrr == 7 {
        let b32 = (lo >> 2) & 3;
        let b10 = lo & 3;
        let mnem = match b32 {
            2 => bit1,
            0 => bit0,
            _ => return undef(ir),
        };
        if mnem.is_empty() {
            return undef(ir);
        }
        return DisasmResult {
            text: format!("{} R0, ({})", mnem, ri_name(b10)),
            word_count: 1,
        };
    }
    if tail == 0x0f {
        return DisasmResult {
            text: format!("{} {}, #{}", bit1, reg_name(rrr), hex16(extra)),
            word_count: 2,
        };
    }
    if tail == 0x07 {
        return DisasmResult {
            text: format!("{} {}, #{}", bit0, reg_name(rrr), hex16(extra)),
            word_count: 2,
        };
    }
    let sss = lo & 7;
    let mnem = if (lo & 8) != 0 { bit1 } else { bit0 };
    DisasmResult {
        text: format!("{} {}, {}", mnem, reg_name(rrr), reg_name(sss)),
        word_count: 1,
    }
}

/// 指定ワードアドレスの 1 命令を逆アセンブルする。
///
/// @param addr ワードアドレス（IC と同じ単位）
/// @param read_word ワードアドレス → 16bit 値
pub fn disassemble_mn1613(addr: u16, read_word: impl Fn(u16) -> u16) -> DisasmResult {
    let a = addr & 0xffff;
    let ir = read_word(a) & 0xffff;
    let extra = read_word(a.wrapping_add(1)) & 0xffff;
    let op = (ir >> 11) & 0x1f;
    let rrr = (ir >> 8) & 7;
    let lo = ir & 0xff;

    if op >= 0x10 {
        let mmm = op & 7;
        let is_hi = (op & 8) != 0;
        let disp = lo & 0xff;
        let ea = match mmm {
            0 => format!("*{}", hex16(disp)),
            1 => hex16(a.wrapping_add((disp as i16) as u16)),
            2 => format!("(*{})", hex16(disp)),
            3 => format!("({})", hex16(a.wrapping_add((disp as i16) as u16))),
            4 => format!("{}(X0)", hex16(disp)),
            5 => format!("{}(X1)", hex16(disp)),
            6 => format!("(*{})(X0)", hex16(disp)),
            _ => format!("(*{})(X1)", hex16(disp)),
        };
        if rrr == 7 {
            let mnem = if is_hi { "B" } else { "BAL" };
            return DisasmResult {
                text: format!("{} {}", mnem, ea),
                word_count: 1,
            };
        }
        if rrr == 6 {
            let mnem = if is_hi { "IMS" } else { "DMS" };
            return DisasmResult {
                text: format!("{} {}", mnem, ea),
                word_count: 1,
            };
        }
        let mnem = if is_hi { "L" } else { "ST" };
        return DisasmResult {
            text: format!("{} {}, {}", mnem, reg_name(rrr), ea),
            word_count: 1,
        };
    }

    match op {
        0x04 => decode04(ir, rrr, lo, extra),
        0x0a => decode_reg_family(ir, rrr, lo, extra, "C", "CB"),
        0x0b => decode_reg_family(ir, rrr, lo, extra, "A", "S"),
        0x0c => decode_reg_family(ir, rrr, lo, extra, "OR", "EOR"),
        0x0d => decode_reg_family(ir, rrr, lo, extra, "AND", "LAD"),
        _ => undef(ir),
    }
}

/// CDB テキスト付き逆アセンブラ（ラベル解決は未実装）。
#[derive(Debug, Default)]
pub struct Mn1613Disassembler;

impl Mn1613Disassembler {
    /// 新しい逆アセンブラを作る。
    pub fn new() -> Self {
        Self
    }

    /// 指定ワードアドレスの 1 命令を逆アセンブルする。
    pub fn disassemble(&self, addr: u16, read_word: impl Fn(u16) -> u16) -> DisasmResult {
        disassemble_mn1613(addr, read_word)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disasm_h_ret_a() {
        let mem = [0x2000_u16, 0x5809, 0x2003];
        let read = |a: u16| mem.get(a as usize).copied().unwrap_or(0);
        assert_eq!(disassemble_mn1613(0, read).text, "H");
        assert_eq!(disassemble_mn1613(2, read).text, "RET");
        assert_eq!(disassemble_mn1613(1, read).text, "A R0, R1");
    }
}
