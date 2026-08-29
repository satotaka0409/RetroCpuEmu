//! MN1613 逆アセンブラ。
//!
//! 根拠: MN1613.mdc / asm-rules.mdc / asm_test_framework.mdc

mod decode;
mod format;
mod labels;

pub use decode::{decode_mn1613, reg_name, rel_target, ri_name, DecodedInst, DecodedOp};
pub use format::{format_decoded, hex16, hex8};
pub use labels::{Mn1613LabelPair, Mn1613LabelTable};

use crate::framework::disasm::DisasmResult;
use crate::error::FrameworkError;

/// 逆アセンブラ初期化オプション。
#[derive(Debug, Clone, Default)]
pub struct Mn1613DisassemblerOptions {
    /// SDCC CDB テキスト（`L:` レコード。アドレスはバイト）
    pub cdb_text: Option<String>,
    /// ラベル一覧（ワードアドレス）。CDB より後に適用して上書きできる
    pub labels: Vec<Mn1613LabelPair>,
}

/// アドレスを与えると 1 命令を逆アセンブルする。
///
/// 初期化で CDB またはラベル:アドレスペアを渡すと、オペランドがラベルになる。
#[derive(Debug, Default)]
pub struct Mn1613Disassembler {
    labels: Mn1613LabelTable,
}

impl Mn1613Disassembler {
    /// 新しい逆アセンブラを作る。
    pub fn new() -> Self {
        Self::default()
    }

    /// オプション付きで作る。
    pub fn with_options(options: Mn1613DisassemblerOptions) -> Result<Self, FrameworkError> {
        let mut d = Self::new();
        if let Some(cdb) = options.cdb_text {
            d.load_cdb(&cdb)?;
        }
        if !options.labels.is_empty() {
            d.set_labels(options.labels);
        }
        Ok(d)
    }

    /// CDB テキストからラベルを読み込む（バイトアドレス → ワード）。
    pub fn load_cdb(&mut self, cdb_text: &str) -> Result<(), FrameworkError> {
        self.labels.load_cdb(cdb_text)
    }

    /// ラベル:ワードアドレスの組を登録する（既存アドレスは上書き）。
    pub fn set_labels(&mut self, entries: impl IntoIterator<Item = Mn1613LabelPair>) {
        self.labels.set_labels(entries);
    }

    /// 1 件追加する。
    pub fn add_label(&mut self, name: &str, word_addr: u16) {
        self.labels.add_label(name, word_addr, "G");
    }

    /// 指定ワードアドレスの 1 命令を逆アセンブルする。
    pub fn disassemble(&self, addr: u16, read_word: impl Fn(u16) -> u16) -> DisasmResult {
        let a = addr & 0xffff;
        let inst = decode_mn1613(a, &read_word);
        let word_count = inst.word_count;
        DisasmResult {
            text: format_decoded(&inst, Some(&self.labels)),
            word_count,
            next_addr: a.wrapping_add(word_count as u16) & 0xffff,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 連続ワードを base から読むリーダを作る。
    fn from_words(words: &[u16], base: u16) -> impl Fn(u16) -> u16 + '_ {
        move |addr| words.get((addr.wrapping_sub(base)) as usize).copied().unwrap_or(0)
    }

    #[test]
    fn basic_h_ret_pshm() {
        let d = Mn1613Disassembler::new();
        let r = d.disassemble(0, from_words(&[0x2000], 0));
        assert_eq!(
            r,
            DisasmResult {
                text: "H".into(),
                word_count: 1,
                next_addr: 1,
            }
        );
        assert_eq!(d.disassemble(0, from_words(&[0x2003], 0)).text, "RET");
        assert_eq!(d.disassemble(0, from_words(&[0x170f], 0)).text, "PSHM");
        assert_eq!(d.disassemble(0, from_words(&[0x1707], 0)).text, "POPM");
        assert_eq!(d.disassemble(0, from_words(&[0x3f07], 0)).text, "RETL");
        assert_eq!(d.disassemble(0, from_words(&[0x3f17], 0)).text, "BLK");
    }

    #[test]
    fn undef_word() {
        let d = Mn1613Disassembler::new();
        assert_eq!(
            d.disassemble(0x100, from_words(&[0x0000], 0x100)),
            DisasmResult {
                text: ".word 0x0000".into(),
                word_count: 1,
                next_addr: 0x101,
            }
        );
    }

    #[test]
    fn mvi_mv_a_ai() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x0812], 0)).text, "MVI R0, #0x12");
        assert_eq!(d.disassemble(0, from_words(&[0x7809], 0)).text, "MV R0, R1");
        assert_eq!(d.disassemble(0, from_words(&[0x5809], 0)).text, "A R0, R1");
        assert_eq!(d.disassemble(0, from_words(&[0x4804], 0)).text, "AI R0, #4");
    }

    #[test]
    fn l_st_zp_and_b_bal() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0xc010], 0)).text, "L R0, *0x10");
        assert_eq!(d.disassemble(0, from_words(&[0x8010], 0)).text, "ST R0, *0x10");
        assert_eq!(d.disassemble(0, from_words(&[0xc710], 0)).text, "B *0x10");
        assert_eq!(d.disassemble(0, from_words(&[0x8710], 0)).text, "BAL *0x10");
    }

    #[test]
    fn relative_l() {
        let d = Mn1613Disassembler::new();
        let r = d.disassemble(0x20, from_words(&[0xc802], 0x20));
        assert_eq!(r.text, "L R0, 0x0022");
        assert_eq!(r.word_count, 1);
        assert_eq!(r.next_addr, 0x21);
    }

    #[test]
    fn ims_dms_lpsw() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0xc610], 0)).text, "IMS *0x10");
        assert_eq!(d.disassemble(0, from_words(&[0x8610], 0)).text, "DMS *0x10");
        assert_eq!(d.disassemble(0, from_words(&[0x2006], 0)).text, "LPSW 2");
    }

    #[test]
    fn push_pop_sr_sl() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x2001], 0)).text, "PUSH R0");
        assert_eq!(d.disassemble(0, from_words(&[0x2102], 0)).text, "POP R1");
        assert_eq!(d.disassemble(0, from_words(&[0x2008], 0)).text, "SR R0");
        assert_eq!(d.disassemble(0, from_words(&[0x200c], 0)).text, "SL R0");
        assert_eq!(d.disassemble(0, from_words(&[0x2009], 0)).text, "SR R0, RE");
    }

    #[test]
    fn tbit_sbit_rbit_neg() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x2803], 0)).text, "TBIT R0, #3");
        assert_eq!(d.disassemble(0, from_words(&[0x3803], 0)).text, "SBIT R0, #3");
        assert_eq!(d.disassemble(0, from_words(&[0x3003], 0)).text, "RBIT R0, #3");
        assert_eq!(d.disassemble(0, from_words(&[0x1f08], 0)).text, "NEG R0");
        assert_eq!(d.disassemble(0, from_words(&[0x1f00], 0)).text, "NEG R0, C");
        assert_eq!(d.disassemble(0, from_words(&[0x1f48], 0)).text, "NEG R0, Z");
    }

    #[test]
    fn skip_a() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x5849], 0)).text, "A R0, R1, Z");
    }

    #[test]
    fn two_word_instructions() {
        let d = Mn1613Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x7807, 0x1234], 0)),
            DisasmResult {
                text: "MVWI R0, #0x1234".into(),
                word_count: 2,
                next_addr: 2,
            }
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x580f, 0x0010], 0)).text,
            "AWI R0, #0x0010"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2708, 0x0100], 0)).text,
            "LD R0, 0x0100"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2718, 0x0100], 0)).text,
            "LD R0, 0x0100(SSBR)"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2748, 0x0100], 0)).text,
            "STD R0, 0x0100"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2607, 0x1800], 0)).text,
            "BD 0x1800"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2617, 0x1800], 0)).text,
            "BALD 0x1800"
        );
    }

    #[test]
    fn bl_ball_tset_trst_lb() {
        let d = Mn1613Disassembler::new();
        assert_eq!(
            d.disassemble(0, from_words(&[0x270f, 0x0200], 0)).text,
            "BL @0x0200"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x271f, 0x0200], 0)).text,
            "BALL @0x0200"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x1708, 0x0100], 0)).text,
            "TSET R0, 0x0100"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x1748, 0x0100], 0)).text,
            "TSET R0, 0x0100, Z"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x1700, 0x0200], 0)).text,
            "TRST R0, 0x0200"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x0f17, 0x0100], 0)).text,
            "LB SSBR, 0x0100"
        );
    }

    #[test]
    fn next_addr_wraps() {
        let d = Mn1613Disassembler::new();
        let r = d.disassemble(0xffff, |a| if a == 0xffff { 0x2000 } else { 0 });
        assert_eq!(r.word_count, 1);
        assert_eq!(r.next_addr, 0);
    }

    #[test]
    fn indirect_special() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x2040], 0)).text, "LR R0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x20c0], 0)).text, "LR R0, (R1)+");
        assert_eq!(d.disassemble(0, from_words(&[0x2080], 0)).text, "LR R0, -(R1)");
        assert_eq!(
            d.disassemble(0, from_words(&[0x2050], 0)).text,
            "LR R0, SSBR, (R1)"
        );
        assert_eq!(d.disassemble(0, from_words(&[0x2044], 0)).text, "STR R0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x2014], 0)).text, "RDR R0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x2010], 0)).text, "WTR R0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x2704], 0)).text, "BR @(R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x2714], 0)).text, "BALR @(R1)");
    }

    #[test]
    fn mvwr_cpyb_setb_srbt_debp_rd() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x7f08], 0)).text, "MVWR R0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x5f08], 0)).text, "AWR R0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x0f80], 0)).text, "CPYB R0, CSBR");
        assert_eq!(d.disassemble(0, from_words(&[0x0f10], 0)).text, "SETB R0, SSBR");
        assert_eq!(d.disassemble(0, from_words(&[0x3f70], 0)).text, "SRBT R0, R0");
        assert_eq!(d.disassemble(0, from_words(&[0x3ff1], 0)).text, "DEBP R1, R0");
        assert_eq!(d.disassemble(0, from_words(&[0x1824], 0)).text, "RD R0, 0x24");
        assert_eq!(d.disassemble(0, from_words(&[0x1024], 0)).text, "WT R0, 0x24");
    }

    #[test]
    fn ad_m_fa_fix() {
        let d = Mn1613Disassembler::new();
        assert_eq!(d.disassemble(0, from_words(&[0x4f0c], 0)).text, "AD DR0, (R1)");
        assert_eq!(
            d.disassemble(0, from_words(&[0x4f04], 0)).text,
            "AD DR0, (R1), C"
        );
        assert_eq!(d.disassemble(0, from_words(&[0x7f0c], 0)).text, "M DR0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x6f0c], 0)).text, "FA DR0, (R1)");
        assert_eq!(d.disassemble(0, from_words(&[0x1f04], 0)).text, "FIX R0, DR0");
    }

    struct InstCase {
        words: &'static [u16],
        text: &'static str,
    }

    fn mnemonic_of(text: &str) -> &str {
        text.split_whitespace().next().unwrap_or("")
    }

    /// MN1613.mdc「命令一覧」の 97 種（未定義 .word は含まない）
    const ALL_MNEMONICS: [&str; 97] = [
        "L", "LD", "LR", "ST", "STD", "STR", "MV", "MVWR", "MVWI", "MVB", "MVBR", "BSWP", "BSWR",
        "DSWP", "DSWR", "PUSH", "PSHM", "POP", "POPM", "MVI", "A", "AWR", "AWI", "AI", "S",
        "SWR", "SWI", "SI", "C", "CWR", "CWI", "CB", "CBR", "CBI", "NEG", "AD", "SD", "M", "D",
        "DAA", "DAS", "LAD", "LADR", "LADI", "FA", "FS", "FM", "FD", "FIX", "FLT", "AND", "ANDR",
        "ANDI", "OR", "ORR", "ORI", "EOR", "EORR", "EORI", "IMS", "DMS", "B", "BD", "BL", "BR",
        "BAL", "BALD", "BALL", "BALR", "RET", "RETL", "LPSW", "TBIT", "SBIT", "RBIT", "TSET",
        "TRST", "SRBT", "DEBP", "SR", "SL", "BLK", "RD", "RDR", "WT", "WTR", "LB", "LS", "STB",
        "STS", "CPYB", "CPYS", "CPYH", "SETB", "SETS", "SETH", "H",
    ];

    #[test]
    fn all_97_mnemonics() {
        let d = Mn1613Disassembler::new();
        let cases: &[InstCase] = &[
            InstCase { words: &[0xc010], text: "L R0, *0x10" },
            InstCase { words: &[0x2708, 0x0100], text: "LD R0, 0x0100" },
            InstCase { words: &[0x2040], text: "LR R0, (R1)" },
            InstCase { words: &[0x8010], text: "ST R0, *0x10" },
            InstCase { words: &[0x2748, 0x0100], text: "STD R0, 0x0100" },
            InstCase { words: &[0x2044], text: "STR R0, (R1)" },
            InstCase { words: &[0x7809], text: "MV R0, R1" },
            InstCase { words: &[0x7f08], text: "MVWR R0, (R1)" },
            InstCase { words: &[0x7807, 0x1234], text: "MVWI R0, #0x1234" },
            InstCase { words: &[0x7801], text: "MVB R0, R1" },
            InstCase { words: &[0x7f00], text: "MVBR R0, (R1)" },
            InstCase { words: &[0x7009], text: "BSWP R0, R1" },
            InstCase { words: &[0x7708], text: "BSWR R0, (R1)" },
            InstCase { words: &[0x7001], text: "DSWP R0, R1" },
            InstCase { words: &[0x7700], text: "DSWR R0, (R1)" },
            InstCase { words: &[0x2001], text: "PUSH R0" },
            InstCase { words: &[0x170f], text: "PSHM" },
            InstCase { words: &[0x2102], text: "POP R1" },
            InstCase { words: &[0x1707], text: "POPM" },
            InstCase { words: &[0x0812], text: "MVI R0, #0x12" },
            InstCase { words: &[0x5809], text: "A R0, R1" },
            InstCase { words: &[0x5f08], text: "AWR R0, (R1)" },
            InstCase { words: &[0x580f, 0x0010], text: "AWI R0, #0x0010" },
            InstCase { words: &[0x4804], text: "AI R0, #4" },
            InstCase { words: &[0x5801], text: "S R0, R1" },
            InstCase { words: &[0x5f00], text: "SWR R0, (R1)" },
            InstCase { words: &[0x5807, 0x0010], text: "SWI R0, #0x0010" },
            InstCase { words: &[0x4005], text: "SI R0, #5" },
            InstCase { words: &[0x5009], text: "C R0, R1" },
            InstCase { words: &[0x5708], text: "CWR R0, (R1)" },
            InstCase { words: &[0x500f, 0x00ff], text: "CWI R0, #0x00ff" },
            InstCase { words: &[0x5001], text: "CB R0, R1" },
            InstCase { words: &[0x5700], text: "CBR R0, (R1)" },
            InstCase { words: &[0x5007, 0x00ff], text: "CBI R0, #0x00ff" },
            InstCase { words: &[0x1f08], text: "NEG R0" },
            InstCase { words: &[0x4f0c], text: "AD DR0, (R1)" },
            InstCase { words: &[0x470c], text: "SD DR0, (R1)" },
            InstCase { words: &[0x7f0c], text: "M DR0, (R1)" },
            InstCase { words: &[0x770c], text: "D DR0, (R1)" },
            InstCase { words: &[0x5f0c], text: "DAA R0, (R1)" },
            InstCase { words: &[0x570c], text: "DAS R0, (R1)" },
            InstCase { words: &[0x6801], text: "LAD R0, R1" },
            InstCase { words: &[0x6f00], text: "LADR R0, (R1)" },
            InstCase { words: &[0x6807, 0x1234], text: "LADI R0, #0x1234" },
            InstCase { words: &[0x6f0c], text: "FA DR0, (R1)" },
            InstCase { words: &[0x6f04], text: "FS DR0, (R1)" },
            InstCase { words: &[0x670c], text: "FM DR0, (R1)" },
            InstCase { words: &[0x6704], text: "FD DR0, (R1)" },
            InstCase { words: &[0x1f04], text: "FIX R0, DR0" },
            InstCase { words: &[0x1f0c], text: "FLT DR0, R0" },
            InstCase { words: &[0x6809], text: "AND R0, R1" },
            InstCase { words: &[0x6f08], text: "ANDR R0, (R1)" },
            InstCase { words: &[0x680f, 0xf0f0], text: "ANDI R0, #0xf0f0" },
            InstCase { words: &[0x6009], text: "OR R0, R1" },
            InstCase { words: &[0x6708], text: "ORR R0, (R1)" },
            InstCase { words: &[0x600f, 0x0f0f], text: "ORI R0, #0x0f0f" },
            InstCase { words: &[0x6001], text: "EOR R0, R1" },
            InstCase { words: &[0x6700], text: "EORR R0, (R1)" },
            InstCase { words: &[0x6007, 0x5555], text: "EORI R0, #0x5555" },
            InstCase { words: &[0xc610], text: "IMS *0x10" },
            InstCase { words: &[0x8610], text: "DMS *0x10" },
            InstCase { words: &[0xc710], text: "B *0x10" },
            InstCase { words: &[0x2607, 0x1800], text: "BD 0x1800" },
            InstCase { words: &[0x270f, 0x0200], text: "BL @0x0200" },
            InstCase { words: &[0x2704], text: "BR @(R1)" },
            InstCase { words: &[0x8710], text: "BAL *0x10" },
            InstCase { words: &[0x2617, 0x1800], text: "BALD 0x1800" },
            InstCase { words: &[0x271f, 0x0200], text: "BALL @0x0200" },
            InstCase { words: &[0x2714], text: "BALR @(R1)" },
            InstCase { words: &[0x2003], text: "RET" },
            InstCase { words: &[0x3f07], text: "RETL" },
            InstCase { words: &[0x2006], text: "LPSW 2" },
            InstCase { words: &[0x2803], text: "TBIT R0, #3" },
            InstCase { words: &[0x3803], text: "SBIT R0, #3" },
            InstCase { words: &[0x3003], text: "RBIT R0, #3" },
            InstCase { words: &[0x1708, 0x0100], text: "TSET R0, 0x0100" },
            InstCase { words: &[0x1700, 0x0200], text: "TRST R0, 0x0200" },
            InstCase { words: &[0x3f70], text: "SRBT R0, R0" },
            InstCase { words: &[0x3ff1], text: "DEBP R1, R0" },
            InstCase { words: &[0x2008], text: "SR R0" },
            InstCase { words: &[0x200c], text: "SL R0" },
            InstCase { words: &[0x3f17], text: "BLK" },
            InstCase { words: &[0x1824], text: "RD R0, 0x24" },
            InstCase { words: &[0x2014], text: "RDR R0, (R1)" },
            InstCase { words: &[0x1024], text: "WT R0, 0x24" },
            InstCase { words: &[0x2010], text: "WTR R0, (R1)" },
            InstCase { words: &[0x0f17, 0x0100], text: "LB SSBR, 0x0100" },
            InstCase { words: &[0x0f0f, 0x0100], text: "LS SBRB, 0x0100" },
            InstCase { words: &[0x0f97, 0x0100], text: "STB SSBR, 0x0100" },
            InstCase { words: &[0x0f8f, 0x0100], text: "STS SBRB, 0x0100" },
            InstCase { words: &[0x0f80], text: "CPYB R0, CSBR" },
            InstCase { words: &[0x0f88], text: "CPYS R0, SBRB" },
            InstCase { words: &[0x3f80], text: "CPYH R0, TCR" },
            InstCase { words: &[0x0f10], text: "SETB R0, SSBR" },
            InstCase { words: &[0x0f08], text: "SETS R0, SBRB" },
            InstCase { words: &[0x3f00], text: "SETH R0, TCR" },
            InstCase { words: &[0x2000], text: "H" },
        ];

        assert_eq!(ALL_MNEMONICS.len(), 97);
        assert_eq!(cases.len(), 97);

        for case in cases {
            let r = d.disassemble(0, from_words(case.words, 0));
            assert_eq!(r.text, case.text, "words={:?}", case.words);
            assert_eq!(r.word_count, case.words.len() as u8);
            assert_eq!(r.next_addr, case.words.len() as u16);
        }

        let mut got = std::collections::HashSet::new();
        for case in cases {
            got.insert(mnemonic_of(case.text));
        }
        assert_eq!(got.len(), 97);
        for m in ALL_MNEMONICS {
            assert!(got.contains(m), "missing {m}");
        }
    }

    #[test]
    fn labels_init_pairs() {
        let d = Mn1613Disassembler::with_options(Mn1613DisassemblerOptions {
            labels: vec![
                Mn1613LabelPair {
                    name: "LOOP".into(),
                    word_addr: 0x0022,
                },
                Mn1613LabelPair {
                    name: "ENTRY".into(),
                    word_addr: 0x1800,
                },
                Mn1613LabelPair {
                    name: "ZPBUF".into(),
                    word_addr: 0x0010,
                },
            ],
            ..Default::default()
        })
        .expect("options");
        assert_eq!(
            d.disassemble(0x20, from_words(&[0xc802], 0x20)).text,
            "L R0, LOOP"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x2607, 0x1800], 0)).text,
            "BD ENTRY"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0xc010], 0)).text,
            "L R0, *ZPBUF"
        );
        assert_eq!(
            d.disassemble(0, from_words(&[0x7807, 0x1800], 0)).text,
            "MVWI R0, #ENTRY"
        );
    }

    #[test]
    fn labels_from_cdb() -> Result<(), FrameworkError> {
        let d = Mn1613Disassembler::with_options(Mn1613DisassemblerOptions {
            cdb_text: Some("L:G$gl_main$0$0:0210\nL:G$gl_bios_beep$0$0:0400\n".into()),
            ..Default::default()
        })?;
        assert_eq!(
            d.disassemble(0, from_words(&[0x2617, 0x0108], 0)).text,
            "BALD gl_main"
        );
        let mut d = d;
        d.add_label("BEEP", 0x0200);
        assert_eq!(
            d.disassemble(0, from_words(&[0x2708, 0x0200], 0)).text,
            "LD R0, BEEP"
        );
        Ok(())
    }

    #[test]
    fn labels_load_cdb_set_labels_later() -> Result<(), FrameworkError> {
        let mut d = Mn1613Disassembler::new();
        d.load_cdb("L:G$vec$0$0:0400\n")?;
        assert_eq!(
            d.disassemble(0, from_words(&[0x270f, 0x0200], 0)).text,
            "BL @vec"
        );
        d.set_labels([Mn1613LabelPair {
            name: "IOCTRL".into(),
            word_addr: 0x22,
        }]);
        assert_eq!(
            d.disassemble(0, from_words(&[0x1822], 0)).text,
            "RD R0, IOCTRL"
        );
        Ok(())
    }
}
