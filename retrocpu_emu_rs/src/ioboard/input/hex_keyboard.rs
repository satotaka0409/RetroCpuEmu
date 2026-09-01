//! 前面 16 進キー行列（HandShake.mdc `14h` 配置）。
//!
//! 列 0–3: 16 進 0–F、列 4–5: F0–F7。列 6–7 は未定義（常に 0）。

/// 列数（応答 8 列。うち 6–7 は常に 0）。
pub const KEY_COLUMN_COUNT: usize = 8;
/// 押下ビットを持つ列（0–5）。
pub const KEY_ACTIVE_COLUMNS: usize = 6;

/// 列 0–5 の Bit3→Bit0（表の左が Bit3＝画面上段）。
pub const HEX_KEY_COL_BIT3_TO_0: [&[&str]; KEY_ACTIVE_COLUMNS] = [
	&["C", "8", "4", "0"],
	&["D", "9", "5", "1"],
	&["E", "A", "6", "2"],
	&["F", "B", "7", "3"],
	&["F0", "F2", "F4", "F6"],
	&["F1", "F3", "F5", "F7"],
];

/// TS `hex_keyboard.ts` の `HEX_KEYS` と同じ 4×4 表示（行=上→下、列=左→右）。
pub const HEX_KEY_ROWS: [[&str; 4]; 4] = [
	["C", "D", "E", "F"],
	["8", "9", "A", "B"],
	["4", "5", "6", "7"],
	["0", "1", "2", "3"],
];

/// 実機 6×4 キーパッド 1 行分（列 0–3=16 進、列 4–5=F0–F7）。
pub const KEYBOARD_ROW_KEYS: [[&str; 6]; 4] = [
	["C", "D", "E", "F", "F0", "F1"],
	["8", "9", "A", "B", "F2", "F3"],
	["4", "5", "6", "7", "F4", "F5"],
	["0", "1", "2", "3", "F6", "F7"],
];

/// ファンクションキー表示名（ioboard.mdc）。
pub const FN_KEY_LABELS: [(&str, &str); 8] = [
	("F0", "ADS"),
	("F1", "CLR"),
	("F2", "INC"),
	("F3", "DEC"),
	("F4", "WINC"),
	("F5", "RUN"),
	("F6", "H/ST"),
	("F7", "RST"),
];

/// パネルキーの列とビットマスク。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PanelKeyLoc {
	/// 列番号 0–5。
	pub col: usize,
	/// その列のビットマスク（Bit3–0）。
	pub mask: u8,
}

/// パネルキー名を `14h` の列とビットマスクへ写す。
///
/// # Arguments
/// - `key`: 関数に渡す値
///
/// # Returns
/// - `Option<PanelKeyLoc>` を返します。
pub fn panel_key_column_mask(key: &str) -> Option<PanelKeyLoc> {
	let k = key.trim().to_ascii_uppercase();
	for (col, names) in HEX_KEY_COL_BIT3_TO_0.iter().enumerate() {
		if let Some(i) = names.iter().position(|n| *n == k) {
			return Some(PanelKeyLoc {
				col,
				mask: 1 << (3 - i),
			});
		}
	}
	None
}

/// ADDR 入力欄に 16 進 1 ニブルを反映する。
pub fn apply_hex_digit_to_addr(word_addr: u32, digit: u8, setting_area: bool) -> u32 {
	let n = u32::from(digit & 0x0f);
	if setting_area {
		((word_addr << 4) | n) & 0xff
	} else {
		(word_addr << 4) | n
	}
}

/// DATA 入力欄に 16 進 1 ニブルを反映する。
pub fn apply_hex_digit_to_data(data_word: u16, digit: u8, setting_area: bool) -> u16 {
	let n = u16::from(digit & 0x0f);
	if setting_area {
		((data_word << 4) | n) & 0xff
	} else {
		((data_word << 4) | n) & 0xffff
	}
}

/// 16 進キー行列の押下状態。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HexKeyboard {
	/// 列 0–7 の押下ビット（Bit3–0。列 6–7 は常に 0）。
	columns: [u8; KEY_COLUMN_COUNT],
}

impl Default for HexKeyboard {
	fn default() -> Self {
		Self::new()
	}
}

impl HexKeyboard {
	/// 全キー離した状態。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			columns: [0; KEY_COLUMN_COUNT],
		}
	}

	/// キーを押す（`"0"`–`"F"` / `"F0"`–`"F7"`）。未知は無視。
	///
	/// # Arguments
	/// - `key`: 関数に渡す値
	pub fn press(&mut self, key: &str) {
		if let Some(loc) = panel_key_column_mask(key) {
			self.columns[loc.col] |= loc.mask;
		}
	}

	/// キーを離す。
	///
	/// # Arguments
	/// - `key`: 関数に渡す値
	pub fn release(&mut self, key: &str) {
		if let Some(loc) = panel_key_column_mask(key) {
			self.columns[loc.col] &= !loc.mask;
		}
	}

	/// 押下／離しをまとめて設定する。
	///
	/// # Arguments
	/// - `key`: 関数に渡す値
	/// - `pressed`: 押下状態フラグ
	pub fn set_pressed(&mut self, key: &str, pressed: bool) {
		if pressed {
			self.press(key);
		} else {
			self.release(key);
		}
	}

	/// 指定キーが押されているか。
	///
	/// # Arguments
	/// - `key`: 関数に渡す値
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn is_pressed(&self, key: &str) -> bool {
		match panel_key_column_mask(key) {
			Some(loc) => (self.columns[loc.col] & loc.mask) != 0,
			None => false,
		}
	}

	/// 全列マスクを返す（ハンドシェイク `14h` 応答用。8 バイト）。
	///
	/// # Returns
	/// - `[u8; KEY_COLUMN_COUNT]` を返します。
	pub fn column_masks(&self) -> [u8; KEY_COLUMN_COUNT] {
		let mut out = self.columns;
		out[6] = 0;
		out[7] = 0;
		out
	}

	/// 全離す。
	pub fn clear(&mut self) {
		self.columns.fill(0);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn hex_key_rows_match_handshake_layout() {
		for row in 0..4 {
			for col in 0..4 {
				assert_eq!(
					HEX_KEY_ROWS[row][col],
					HEX_KEY_COL_BIT3_TO_0[col][row],
					"row {row} col {col}"
				);
			}
		}
		assert_eq!(HEX_KEY_ROWS[0], ["C", "D", "E", "F"]);
		assert_eq!(HEX_KEY_ROWS[3], ["0", "1", "2", "3"]);
	}

	#[test]
	fn keyboard_row_keys_match_columns() {
		for row in 0..4 {
			for col in 0..6 {
				assert_eq!(
					KEYBOARD_ROW_KEYS[row][col],
					HEX_KEY_COL_BIT3_TO_0[col][row]
				);
			}
		}
	}

	#[test]
	fn press_hex_and_fn() {
		let mut kb = HexKeyboard::new();
		kb.press("A");
		kb.press("F0");
		assert!(kb.is_pressed("A"));
		assert!(kb.is_pressed("F0"));
		let cols = kb.column_masks();
		assert_ne!(cols[2] & 0x04, 0); // E A 6 2 → A は Bit2
		assert_ne!(cols[4] & 0x08, 0); // F0 は Bit3
		kb.release("A");
		assert!(!kb.is_pressed("A"));
	}

	#[test]
	fn apply_hex_digit_addr_and_data() {
		assert_eq!(apply_hex_digit_to_addr(0x1234, 0xa, false), 0x1234a);
		assert_eq!(apply_hex_digit_to_addr(0x12, 0x3, true), 0x23);
		assert_eq!(apply_hex_digit_to_data(0x1234, 0xb, false), 0x234b);
		assert_eq!(apply_hex_digit_to_data(0x12, 0x3, true), 0x23);
	}
}
