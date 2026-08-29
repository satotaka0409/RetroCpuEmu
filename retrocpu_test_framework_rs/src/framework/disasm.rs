//! 逆アセンブル共通型。

/// 1 命令の逆アセンブル結果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisasmResult {
    /// 逆アセンブル文字列（ラベル解決済み、asm-rules 推奨書式）
    pub text: String,
    /// 消費した 16bit ワード数（1〜3）
    pub word_count: u8,
    /// 次命令アドレス（16bit ラップ）。MN1613 はワード、TMS9995 はバイト。
    pub next_addr: u16,
}
