//! 入力装置（16 進キー行列など）。

pub mod hex_keyboard;

pub use hex_keyboard::{
	apply_hex_digit_to_addr, apply_hex_digit_to_data, panel_key_column_mask, HexKeyboard,
	PanelKeyLoc, FN_KEY_LABELS, HEX_KEY_COL_BIT3_TO_0,
	KEY_ACTIVE_COLUMNS, KEY_COLUMN_COUNT,
};
