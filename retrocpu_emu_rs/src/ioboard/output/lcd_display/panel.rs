//! LCD1602 互換の最小表示エミュレータ。
//!
//! CPU→IO ハンドシェイク（`17h`/`18h`）の解釈は `ioboard::handshake::lcd` が担当する。

/// LCD1602 の列数（16 桁）。
pub const LCD_COLS: usize = 16;
/// LCD1602 の行数（2 行）。
pub const LCD_ROWS: usize = 2;

const SPACE: u8 = 0x20;

/// LCD 表示スナップショット。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LcdDisplaySnapshot {
	/// 列数（16）。
	pub cols: usize,
	/// 行数（2）。
	pub rows: usize,
	/// 2 行分テキスト。
	pub lines: [String; 2],
	/// カーソル行（0/1）。
	pub cursor_row: u8,
	/// カーソル列（0..15）。
	pub cursor_col: u8,
	/// 表示 ON/OFF。
	pub display_on: bool,
	/// カーソル表示 ON/OFF。
	pub cursor_on: bool,
	/// カーソル点滅 ON/OFF。
	pub blink_on: bool,
}

/// LCD1602 エミュレータ。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LcdDisplay {
	ddram: [u8; LCD_COLS * LCD_ROWS],
	cursor_row: u8,
	cursor_col: u8,
	display_on: bool,
	cursor_on: bool,
	blink_on: bool,
}

impl Default for LcdDisplay {
	fn default() -> Self {
		Self::new()
	}
}

impl LcdDisplay {
	/// 新規作成（電源投入相当）。
	pub fn new() -> Self {
		let mut s = Self {
			ddram: [SPACE; LCD_COLS * LCD_ROWS],
			cursor_row: 0,
			cursor_col: 0,
			display_on: true,
			cursor_on: false,
			blink_on: false,
		};
		s.reset();
		s
	}

	/// 電源投入相当の状態へ戻す。
	pub fn reset(&mut self) {
		self.ddram.fill(SPACE);
		self.cursor_row = 0;
		self.cursor_col = 0;
		self.display_on = true;
		self.cursor_on = false;
		self.blink_on = false;
	}

	/// 全消去してカーソルを先頭へ戻す。
	pub fn clear(&mut self) {
		self.ddram.fill(SPACE);
		self.home();
	}

	/// カーソルをホームへ戻す。
	pub fn home(&mut self) {
		self.cursor_row = 0;
		self.cursor_col = 0;
	}

	/// 表示制御ビットを適用する。
	pub fn set_display_control(&mut self, bits: u8) {
		self.display_on = (bits & 0x01) != 0;
		self.cursor_on = (bits & 0x02) != 0;
		self.blink_on = (bits & 0x04) != 0;
	}

	/// カーソル位置を設定する。
	pub fn set_cursor(&mut self, row: u8, col: u8) -> bool {
		if !self.valid_row(row) || !self.valid_col(col) {
			return false;
		}
		self.cursor_row = row;
		self.cursor_col = col;
		true
	}

	/// 指定位置からテキストを書き込む（行末で打ち切り）。
	pub fn write_text_ascii(&mut self, row: u8, col: u8, text: &[u8]) -> bool {
		if !self.valid_row(row) || !self.valid_col(col) {
			return false;
		}
		let mut c = col as usize;
		for &ch in text {
			if c >= LCD_COLS {
				break;
			}
			let idx = self.index_of(row as usize, c);
			self.ddram[idx] = normalize_ascii(ch);
			c += 1;
		}
		self.cursor_row = row;
		self.cursor_col = (c.min(LCD_COLS - 1)) as u8;
		true
	}

	/// 現在状態のスナップショット。
	pub fn snapshot(&self) -> LcdDisplaySnapshot {
		LcdDisplaySnapshot {
			cols: LCD_COLS,
			rows: LCD_ROWS,
			lines: [self.read_line(0), self.read_line(1)],
			cursor_row: self.cursor_row,
			cursor_col: self.cursor_col,
			display_on: self.display_on,
			cursor_on: self.cursor_on,
			blink_on: self.blink_on,
		}
	}

	fn read_line(&self, row: usize) -> String {
		let mut line = String::with_capacity(LCD_COLS);
		for col in 0..LCD_COLS {
			let code = self.ddram[self.index_of(row, col)];
			line.push(char::from(normalize_ascii(code)));
		}
		line
	}

	fn valid_row(&self, row: u8) -> bool {
		row < LCD_ROWS as u8
	}

	fn valid_col(&self, col: u8) -> bool {
		(col as usize) < LCD_COLS
	}

	fn index_of(&self, row: usize, col: usize) -> usize {
		row * LCD_COLS + col
	}
}

fn normalize_ascii(code: u8) -> u8 {
	if (0x20..=0x7e).contains(&code) {
		code
	} else {
		SPACE
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::board_link::response;
	use crate::ioboard::handshake::lcd::{
		handle_lcd_control_frame, handle_lcd_text_frame, CMD_LCD_CTRL, CMD_LCD_TEXT, LCD_CTRL_CLEAR,
		LCD_CTRL_HOME, LCD_CTRL_SET_CURSOR,
	};

	#[test]
	fn control_clear_home_and_cursor() {
		let mut lcd = LcdDisplay::new();
		assert_eq!(
			handle_lcd_control_frame(&[CMD_LCD_CTRL, 0, LCD_CTRL_SET_CURSOR, 0, 1, 15], &mut lcd),
			response::OK
		);
		assert_eq!(
			handle_lcd_control_frame(&[CMD_LCD_CTRL, 0, LCD_CTRL_HOME, 0, 0, 0], &mut lcd),
			response::OK
		);
		assert_eq!(lcd.snapshot().cursor_row, 0);
		assert_eq!(lcd.snapshot().cursor_col, 0);
		assert_eq!(
			handle_lcd_control_frame(&[CMD_LCD_CTRL, 0, LCD_CTRL_CLEAR, 0, 0, 0], &mut lcd),
			response::OK
		);
	}

	#[test]
	fn text_write_and_clip() {
		let mut lcd = LcdDisplay::new();
		let frame = [CMD_LCD_TEXT, 1, 14, 4, b'A', b'B', b'C', b'D'];
		assert_eq!(handle_lcd_text_frame(&frame, &mut lcd), response::OK);
		let snap = lcd.snapshot();
		assert_eq!(&snap.lines[1][14..16], "AB");
	}

	#[test]
	fn invalid_row_is_ng() {
		let mut lcd = LcdDisplay::new();
		assert_eq!(
			handle_lcd_text_frame(&[CMD_LCD_TEXT, 2, 0, 1, b'X'], &mut lcd),
			response::NG
		);
	}
}
