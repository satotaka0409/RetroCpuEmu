//! デコード済み TMS9995 命令を asm-rules（sdas 風）の文字列にする。
//!
//! 根拠: asm_rules.mdc / TMS9995_instruction.mdc

use super::decode::{DecodedInst, DecodedOp};
use super::labels::Tms9995LabelTable;

/// 16bit 値を `0xhhhh` にする。
pub fn hex16(v: u16) -> String {
    format!("0x{:04x}", v & 0xffff)
}

fn sym_text(byte_addr: u16, labels: Option<&Tms9995LabelTable>) -> String {
    if let Some(labels) = labels {
        if let Some(name) = labels.lookup(byte_addr) {
            return name.to_string();
        }
    }
    hex16(byte_addr)
}

fn imm_text(v: u16, labels: Option<&Tms9995LabelTable>) -> String {
    if let Some(labels) = labels {
        if let Some(name) = labels.lookup(v) {
            return format!("#{name}");
        }
    }
    format!("#{}", hex16(v))
}

fn format_op(op: &DecodedOp, labels: Option<&Tms9995LabelTable>) -> String {
    match op {
        DecodedOp::Reg(r) => format!("R{}", r & 0xf),
        DecodedOp::Indirect(r) => format!("(R{})", r & 0xf),
        DecodedOp::AutoInc(r) => format!("(R{})+", r & 0xf),
        DecodedOp::Sym(a) => sym_text(*a, labels),
        DecodedOp::Indexed { addr, reg } => {
            format!("{}(R{})", sym_text(*addr, labels), reg & 0xf)
        }
        DecodedOp::Imm(v) => imm_text(*v, labels),
        DecodedOp::ImmDisp(d) => format!("#{}", *d),
        DecodedOp::ImmCount(c) => format!("#{}", c),
        DecodedOp::JumpTarget(a) => sym_text(*a, labels),
        DecodedOp::XopNum(n) => format!("#{}", n),
    }
}

/// デコード結果を 1 行の逆アセンブル文字列にする。
pub fn format_decoded(inst: &DecodedInst, labels: Option<&Tms9995LabelTable>) -> String {
    if inst.mnemonic == ".word" {
        if let Some(DecodedOp::Imm(v)) = inst.ops.first() {
            return format!(".word {}", hex16(*v));
        }
    }
    if inst.ops.is_empty() {
        return inst.mnemonic.clone();
    }
    let parts: Vec<String> = inst
        .ops
        .iter()
        .map(|op| format_op(op, labels))
        .collect();
    format!("{} {}", inst.mnemonic, parts.join(", "))
}
