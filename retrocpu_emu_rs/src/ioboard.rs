//! IO ボード（1階相当）。
//!
//! 出力 LED・設定・DMA・キー・コンソール・ハンドシェイクをまとめる。

pub mod board;
pub mod dma;
pub mod handshake;
pub mod input;
pub mod monitor;
pub mod output;
pub mod setting_area;

// IO ボード本体とスナップショット API。
pub use board::{IoBoard, IoBoardSnapshot};
// Intel HEX を DMA 実行計画へ変換・読み込みするユーティリティ。
pub use dma::{
	dma_load_intel_hex, dma_load_intel_hex_file, intel_hex_to_dma_plan, IntelHexDmaChunk,
	IntelHexDmaPlan, IntelHexError,
};
// CPU とのハンドシェイク電文の生成・送出、および LCD ログ連携。
pub use handshake::{
	dispatch_io_to_cpu, encode_exec, encode_mem_read, encode_mem_write, exec, mem_read, mem_write,
	HandshakeDispatcher, LcdLogEvent, PanelEventLogger, CMD_LCD_CTRL, CMD_LCD_TEXT, LCD_CTRL_CLEAR,
	LCD_CTRL_DISPLAY, LCD_CTRL_HOME, LCD_CTRL_SET_CURSOR,
};
// 16 進キーパネル入力と列選択マスク・定数。
pub use input::{
	apply_hex_digit_to_addr, apply_hex_digit_to_data, panel_key_column_mask, HexKeyboard,
	PanelKeyLoc, FN_KEY_LABELS, HEX_KEY_COL_BIT3_TO_0, KEY_ACTIVE_COLUMNS, KEY_COLUMN_COUNT,
};
// 前面モニター（コンソールUI状態と M/R/W/EXEC 操作）。
pub use monitor::{ConsoleFnKey, ConsoleFocus, ConsoleMode, IoConsole, IoConsoleState, IoMonitor};
// LCD 表示モデルと表示サイズ定数。
pub use output::lcd_display::{LcdDisplay, LcdDisplaySnapshot, LCD_COLS, LCD_ROWS};
// 設定領域の既定値・JSONC 解析・オフセット情報。
pub use setting_area::{
	default_settings_for_cpu, load_settings_jsonc, offsets, parse_settings_jsonc, IoBoardSettings,
};
