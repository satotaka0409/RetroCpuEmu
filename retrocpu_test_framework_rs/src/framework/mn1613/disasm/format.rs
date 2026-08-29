//! デコード済み MN1613 命令を asm-rules 書式の文字列にする。
//!
//! 根拠: asm-rules.mdc / MN1613.mdc

use super::decode::{AddrForm, DecodedInst, DecodedOp};
use super::labels::Mn1613LabelTable;

const SKIP_NAME: [&str; 16] = [
    "", "SKP", "M", "PZ", "Z", "NZ", "MZ", "P", "EZ", "ENZ", "OZ", "ONZ", "LMZ", "LP", "LPZ",
    "LM",
];

const EE_NAME: [&str; 4] = ["", "RE", "SE", "CE"];

/// 16bit 値を `0xhhhh` にする。
pub fn hex16(v: u16) -> String {
    format!("0x{:04x}", v & 0xffff)
}

/// 8bit 値を `0xhh` にする。
pub fn hex8(v: u16) -> String {
    format!("0x{:02x}", v & 0xff)
}

fn addr_text(word_addr: u16, labels: Option<&Mn1613LabelTable>, width: u8) -> String {
    if let Some(labels) = labels {
        if let Some(name) = labels.lookup(word_addr) {
            return name.to_string();
        }
    }
    if width == 8 {
        hex8(word_addr)
    } else {
        hex16(word_addr)
    }
}

fn imm_text(v: u16, bits: u8, labels: Option<&Mn1613LabelTable>) -> String {
    if bits == 16 {
        if let Some(labels) = labels {
            if let Some(name) = labels.lookup(v & 0xffff) {
                return format!("#{name}");
            }
        }
        return format!("#{}", hex16(v));
    }
    if bits == 8 {
        return format!("#{}", hex8(v));
    }
    format!("#{}", v & 0xf)
}

fn format_addr(
    v: u16,
    form: AddrForm,
    bb: Option<&str>,
    labels: Option<&Mn1613LabelTable>,
) -> String {
    match form {
        AddrForm::Plain => addr_text(v, labels, 16),
        AddrForm::Zp => format!("*{}", addr_text(v, labels, 8)),
        AddrForm::Paren => format!("({})", addr_text(v, labels, 16)),
        AddrForm::At => format!("@{}", addr_text(v, labels, 16)),
        AddrForm::StarParen => format!("(*{})", addr_text(v, labels, 8)),
        AddrForm::Io => addr_text(v, labels, 8),
        AddrForm::Bb => format!(
            "{}({})",
            addr_text(v, labels, 16),
            bb.unwrap_or("CSBR")
        ),
    }
}

fn format_op(op: &DecodedOp, labels: Option<&Mn1613LabelTable>) -> Option<String> {
    match op {
        DecodedOp::Raw(s) => Some(s.clone()),
        DecodedOp::Imm { v, bits } => Some(imm_text(*v, *bits, labels)),
        DecodedOp::Skip(n) => {
            let name = SKIP_NAME[(*n & 0xf) as usize];
            if name.is_empty() {
                None
            } else {
                Some(name.to_string())
            }
        }
        DecodedOp::Ee(n) => {
            let name = EE_NAME[(*n & 3) as usize];
            if name.is_empty() {
                None
            } else {
                Some(name.to_string())
            }
        }
        DecodedOp::C => Some("C".into()),
        DecodedOp::Addr { v, form, bb } => Some(format_addr(*v, *form, bb.as_deref(), labels)),
    }
}

/// デコード結果を 1 行のアセンブリにする。
pub fn format_decoded(inst: &DecodedInst, labels: Option<&Mn1613LabelTable>) -> String {
    if inst.mnemonic == ".word" {
        if let Some(DecodedOp::Imm { v, .. }) = inst.ops.first() {
            return format!(".word {}", hex16(*v));
        }
    }
    let args: Vec<String> = inst
        .ops
        .iter()
        .filter_map(|op| format_op(op, labels))
        .collect();
    if args.is_empty() {
        inst.mnemonic.clone()
    } else {
        format!("{} {}", inst.mnemonic, args.join(", "))
    }
}
