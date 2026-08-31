//! TMS9995 IO ポート定数（暫定）。

/// IO:0000 - リセットベクタ（ワードアドレス）
pub const IO_PORT_RESET_VECTOR: u16 = 0x0000;

/// TMS9995 側の既定リセットベクタ（暫定）
pub const MONITOR_ENTRY_WORD: u32 = 0x0108;
/// IO:0 の値からの STR 語オフセット（暫定互換）
pub const RESET_VECTOR_STR_OFF: u16 = 2;
/// IO:0 の値からの IC 語オフセット（暫定互換）
pub const RESET_VECTOR_IC_OFF: u16 = 3;
