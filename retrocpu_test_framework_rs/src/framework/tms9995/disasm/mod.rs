//! TMS9995 逆アセンブラ。
//!
//! 根拠: TMS9995_instruction.mdc / asm_rules.mdc / retrocpu_asm_rs `tms9995_encoder.rs`

mod decode;
mod format;
mod labels;

pub use decode::{decode_tms9995, reg_name, DecodedInst, DecodedOp};
pub use format::{format_decoded, hex16};
pub use labels::{Tms9995LabelPair, Tms9995LabelTable};

use crate::framework::disasm::DisasmResult;
use crate::error::FrameworkError;

/// 逆アセンブラ初期化オプション。
#[derive(Debug, Clone, Default)]
pub struct Tms9995DisassemblerOptions {
    /// SDCC CDB テキスト（`L:` レコード。アドレスはバイト）
    pub cdb_text: Option<String>,
    /// ラベル一覧（バイトアドレス）。CDB より後に適用して上書きできる
    pub labels: Vec<Tms9995LabelPair>,
}

/// バイトアドレス（偶数）を与えると 1 命令を逆アセンブルする。
///
/// `read_word` は読み取る 16bit 語先頭の**バイトアドレス**（偶数）を受け取る。
/// `DisasmResult::next_addr` もバイトアドレス（MN1613 逆アセンブラはワードアドレス）。
#[derive(Debug, Default)]
pub struct Tms9995Disassembler {
    labels: Tms9995LabelTable,
}

impl Tms9995Disassembler {
    /// 新しい逆アセンブラを作る。
    pub fn new() -> Self {
        Self::default()
    }

    /// オプション付きで作る。
    pub fn with_options(options: Tms9995DisassemblerOptions) -> Result<Self, FrameworkError> {
        let mut d = Self::new();
        if let Some(cdb) = options.cdb_text {
            d.load_cdb(&cdb)?;
        }
        if !options.labels.is_empty() {
            d.set_labels(options.labels);
        }
        Ok(d)
    }

    /// CDB テキストからラベルを読み込む。
    pub fn load_cdb(&mut self, cdb_text: &str) -> Result<(), FrameworkError> {
        self.labels.load_cdb(cdb_text)
    }

    /// ラベル:バイトアドレスの組を登録する（既存アドレスは上書き）。
    pub fn set_labels(&mut self, entries: impl IntoIterator<Item = Tms9995LabelPair>) {
        self.labels.set_labels(entries);
    }

    /// 1 件追加する。
    pub fn add_label(&mut self, name: &str, byte_addr: u16) {
        self.labels.add_label(name, byte_addr, "G");
    }

    /// 指定バイトアドレス（偶数）の 1 命令を逆アセンブルする。
    pub fn disassemble(&self, byte_addr: u16, read_word: impl Fn(u16) -> u16) -> DisasmResult {
        let pc = byte_addr & 0xfffe;
        let inst = decode_tms9995(pc, &read_word);
        let word_count = inst.word_count;
        DisasmResult {
            text: format_decoded(&inst, Some(&self.labels)),
            word_count,
            next_addr: pc.wrapping_add((word_count as u16) * 2) & 0xffff,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 連続ワードを base バイトアドレスから読むリーダを作る。
    fn from_words(words: &[u16], base_byte: u16) -> impl Fn(u16) -> u16 + '_ {
        move |byte_addr| {
            let idx = byte_addr.wrapping_sub(base_byte) / 2;
            words.get(idx as usize).copied().unwrap_or(0)
        }
    }

    #[test]
    fn format1_mov_a() {
        let d = Tms9995Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0xc081], 0)).text,
            "MOV R1, R2"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0xa081], 0)).text,
            "A R1, R2"
        );
    }

    #[test]
    fn format2_jmp_and_cru() {
        let d = Tms9995Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x1000], 0)).text,
            "JMP 0x0002"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x1300], 0)).text,
            "JEQ 0x0002"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x1d00], 0)).text,
            "SBO #0"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x1fff], 0)).text,
            "TB #-1"
        );
    }

    #[test]
    fn format8_li_lwpi() {
        let d = Tms9995Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x0201, 0x0001], 0)).text,
            "LI R1, #0x0001"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x02e0, 0x8300], 0)).text,
            "LWPI #0x8300"
        );
    }

    #[test]
    fn format6_rtwp_and_b_r11() {
        let d = Tms9995Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x0380], 0)).text,
            "RTWP"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x045b], 0)).text,
            "B (R11)"
        );
    }

    #[test]
    fn tms9995_specific() {
        let d = Tms9995Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x0081], 0)).text,
            "LST R1"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x0180], 0)).text,
            "DIVS R0"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x01c0], 0)).text,
            "MPYS R0"
        );
    }

    #[test]
    fn ldcr_stcr_xop() {
        let d = Tms9995Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x3201], 0)).text,
            "LDCR R1, #8"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x3401], 0)).text,
            "STCR R1, #16"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2cc1], 0)).text,
            "XOP R1, #3"
        );
    }

    #[test]
    fn symbolic_mov_with_label() {
        let mut d = Tms9995Disassembler::new();
        d.add_label("LAB", 0x1000);
        let words = [0xc020, 0x1000];
        assert_eq!(
            d.disassemble(0, from_words(&words, 0)).text,
            "MOV LAB, R0"
        );
    }

    #[test]
    fn all_insn_table() {
        let cases: &[(&str, &[u16])] = &[
            ("SZC R1, R2", &[0x4081]),
            ("SZCB R1, R2", &[0x5081]),
            ("S R1, R2", &[0x6081]),
            ("SB R1, R2", &[0x7081]),
            ("C R1, R2", &[0x8081]),
            ("CB R1, R2", &[0x9081]),
            ("A R1, R2", &[0xa081]),
            ("AB R1, R2", &[0xb081]),
            ("MOV R1, R2", &[0xc081]),
            ("MOVB R1, R2", &[0xd081]),
            ("SOC R1, R2", &[0xe081]),
            ("SOCB R1, R2", &[0xf081]),
            ("JMP 0x0002", &[0x1000]),
            ("JLT 0x0002", &[0x1100]),
            ("JLE 0x0002", &[0x1200]),
            ("JEQ 0x0002", &[0x1300]),
            ("JHE 0x0002", &[0x1400]),
            ("JGT 0x0002", &[0x1500]),
            ("JNE 0x0002", &[0x1600]),
            ("JNC 0x0002", &[0x1700]),
            ("JOC 0x0002", &[0x1800]),
            ("JNO 0x0002", &[0x1900]),
            ("JL 0x0002", &[0x1a00]),
            ("JH 0x0002", &[0x1b00]),
            ("JOP 0x0002", &[0x1c00]),
            ("SBO #0", &[0x1d00]),
            ("SBZ #1", &[0x1e01]),
            ("TB #-1", &[0x1fff]),
            ("COC R1, R2", &[0x2081]),
            ("CZC R1, R2", &[0x2481]),
            ("XOR R1, R2", &[0x2881]),
            ("XOP R1, #3", &[0x2cc1]),
            ("LDCR R1, #8", &[0x3201]),
            ("STCR R1, #16", &[0x3401]),
            ("MPY R1, R2", &[0x3881]),
            ("DIV R1, R2", &[0x3c81]),
            ("SRA R1, #0", &[0x0801]),
            ("SRL R1, #1", &[0x0911]),
            ("SLA R1, #2", &[0x0a21]),
            ("SRC R1, #15", &[0x0bf1]),
            ("DIVS R0", &[0x0180]),
            ("MPYS R0", &[0x01c0]),
            ("BLWP R0", &[0x0400]),
            ("B R0", &[0x0440]),
            ("X R0", &[0x0480]),
            ("CLR R0", &[0x04c0]),
            ("NEG R0", &[0x0500]),
            ("INV R0", &[0x0540]),
            ("INC R0", &[0x0580]),
            ("INCT R0", &[0x05c0]),
            ("DEC R0", &[0x0600]),
            ("DECT R0", &[0x0640]),
            ("BL R0", &[0x0680]),
            ("SWPB R0", &[0x06c0]),
            ("SETO R0", &[0x0700]),
            ("ABS R0", &[0x0740]),
            ("IDLE", &[0x0340]),
            ("RSET", &[0x0360]),
            ("RTWP", &[0x0380]),
            ("CKON", &[0x03a0]),
            ("CKOF", &[0x03c0]),
            ("LREX", &[0x03e0]),
            ("LI R1, #0x0001", &[0x0201, 0x0001]),
            ("AI R1, #0x0001", &[0x0221, 0x0001]),
            ("ANDI R1, #0x0001", &[0x0241, 0x0001]),
            ("ORI R1, #0x0001", &[0x0261, 0x0001]),
            ("CI R1, #0x0001", &[0x0281, 0x0001]),
            ("LWPI #0x0000", &[0x02e0, 0x0000]),
            ("LIMI #0x0000", &[0x0300, 0x0000]),
            ("STWP R1", &[0x02a1]),
            ("STST R1", &[0x02c1]),
            ("LST R1", &[0x0081]),
            ("LWP R1", &[0x0091]),
            ("B (R11)", &[0x045b]),
            ("JMP 0x0002", &[0x1000]),
        ];

        let d = Tms9995Disassembler::new();
        for (expected, words) in cases {
            let got = d.disassemble(0, from_words(words, 0)).text;
            assert_eq!(&got, expected, "words={words:02x?}");
        }
    }
}
