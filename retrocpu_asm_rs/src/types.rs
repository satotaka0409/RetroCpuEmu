//! アセンブル中間表現と成果物型。

use std::collections::HashMap;

use crate::cpu_type::CpuType;

/// ソース 1 行（行番号付き原文）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLine {
    /// 1 始まり行番号。
    pub line_no: usize,
    /// 改行除く原文。
    pub text: String,
}

/// パース済み 1 行（ラベル・オペコード・引数）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedLine {
    /// 1 始まり行番号。
    pub line_no: usize,
    /// 原文（LST 出力用）。
    pub text: String,
    /// `LABEL:` のラベル名。無ければ None。
    pub label: Option<String>,
    /// オペコード／疑似命令（大文字化済み）。
    pub op: Option<String>,
    /// カンマ区切り引数（括弧・引用符内のカンマは分割しない）。
    pub args: Vec<String>,
}

/// エンコード結果の 1 語（または TMS9995 の 1 エントリ）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedWord {
    /// 配置アドレス（MN1613=ワード、TMS9995=バイト）。
    pub address: u16,
    /// 配置先 `.area`（大文字）。
    pub area: String,
    /// 16bit 機械語。
    pub value: u16,
    /// 由来行番号。
    pub line_no: usize,
    /// 由来行テキスト。
    pub source: String,
}

/// `words[].address` の単位（LST はそのまま。MN1613 の REL だけバイトに換算）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressUnit {
    /// MN1613: ワードアドレス（LST）。REL 出力時×2。
    Word,
    /// TMS9995: バイトアドレス（LST / REL 共通）。
    Byte,
}

/// `assemble` の戻り値。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssemblyResult {
    /// エンコード済み語列。
    pub words: Vec<EmittedWord>,
    /// ラベル名（大文字）→ アドレス／値。
    pub symbols: HashMap<String, u16>,
    /// 全ソース行（LST 用）。
    pub source_lines: Vec<SourceLine>,
    /// 対象 CPU。
    pub cpu_type: CpuType,
    /// `words[].address` の単位。
    pub address_unit: AddressUnit,
    /// `.ds` / `.blkw` 行の先頭アドレス（行番号 → アドレス）。LST のアドレス列用。
    pub storage_addrs: HashMap<usize, u16>,
    /// リロケーション用シンボル情報（大文字キー）。
    pub symbol_infos: HashMap<String, SymbolInfo>,
    /// ワード差／絶対アドレスのリロケーション列。
    pub relocs: Vec<WordDiffReloc>,
}

/// シンボルの可視性。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolKind {
    /// モジュール内ローカル。
    Local,
    /// `.globl` 定義済み。
    Global,
    /// `.globl` のみ（未定義）。
    External,
}

/// シンボル情報（値はワード／バイトアドレス。external は 0）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymbolInfo {
    /// シンボル値。
    pub value: u16,
    /// 可視性。
    pub kind: SymbolKind,
    /// ラベルが属する `.area`（`.equ` は None）。
    pub area: Option<String>,
}

/// リロケーションオペランド。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RelocOperand {
    /// 外部／グローバル（`SYM-=0000`）。
    Symbol {
        /// 大文字シンボル名。
        name: String,
    },
    /// モジュール内オフセット（`#_AREA:0000`）。
    Word {
        /// 領域内ワード／バイトオフセット。
        value: u16,
        /// 属する領域名。
        area: Option<String>,
    },
    /// 絶対定数。
    Const {
        /// 16bit 値。
        value: u16,
    },
}

/// リロケーションの書き込み幅。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelocWidth {
    /// 16bit 語（R3_WORD）。
    Word16,
    /// 命令語下位 8bit（R3_BYTE）。
    Low8,
}

/// リンク時に埋めるリロケーション。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WordDiffReloc {
    /// パッチ先バイトアドレス（領域内オフセット）。
    pub byte_addr: u16,
    /// 左オペランド。
    pub left: RelocOperand,
    /// 右オペランド。
    pub right: RelocOperand,
    /// パッチ先 `.area`（省略時 `_CODE`）。
    pub area: Option<String>,
    /// 書き込み幅（省略時 word16）。
    pub width: Option<RelocWidth>,
}
