//! MN1613 IO ポート定数。

/// IO:0000 - リセットベクタ（ワードアドレス）
pub const IO_PORT_RESET_VECTOR: u16 = 0x0000;

/// モニターのリセットベクタ表先頭（`g_reset_vector`）
pub const MONITOR_ENTRY_WORD: u32 = 0x0108;
/// IO:0 の値からの STR 語オフセット
pub const RESET_VECTOR_STR_OFF: u16 = 2;
/// IO:0 の値からの IC 語オフセット
pub const RESET_VECTOR_IC_OFF: u16 = 3;
