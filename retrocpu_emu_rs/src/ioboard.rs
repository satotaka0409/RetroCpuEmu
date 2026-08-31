//! IO ボード（1階相当）。
//!
//! 出力 LED・設定・DMA・キー・コンソール・ハンドシェイクをまとめる。

pub mod board;
pub mod console;
pub mod dma;
pub mod handshake;
pub mod input;
pub mod output;
pub mod setting_area;

pub use board::{IoBoard, IoBoardSnapshot};
pub use console::{ConsoleFnKey, ConsoleFocus, ConsoleMode, IoConsole, IoConsoleState};
pub use dma::{
	dma_load_intel_hex, dma_load_intel_hex_file, intel_hex_to_dma_plan, IntelHexDmaChunk,
	IntelHexDmaPlan, IntelHexError,
};
pub use handshake::{
	dispatch_io_to_cpu, encode_exec, encode_mem_read, encode_mem_write, exec, mem_read, mem_write,
	HandshakeDispatcher, LcdLogEvent, PanelEventLogger, CMD_LCD_CTRL, CMD_LCD_TEXT, LCD_CTRL_CLEAR,
	LCD_CTRL_DISPLAY, LCD_CTRL_HOME, LCD_CTRL_SET_CURSOR,
};
pub use input::{
	panel_key_column_mask, HexKeyboard, PanelKeyLoc, FN_KEY_LABELS, HEX_KEY_COL_BIT3_TO_0,
	KEY_ACTIVE_COLUMNS, KEY_COLUMN_COUNT,
};
pub use output::lcd_display::{LcdDisplay, LcdDisplaySnapshot, LCD_COLS, LCD_ROWS};
pub use setting_area::{
	default_settings_for_cpu, load_settings_jsonc, offsets, parse_settings_jsonc, IoBoardSettings,
};
