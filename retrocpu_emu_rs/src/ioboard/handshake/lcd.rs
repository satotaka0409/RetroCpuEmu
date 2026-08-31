//! LCD1602 向け CPU→IO ハンドシェイク（17h/18h）。

use crate::board_link::response;
use crate::ioboard::output::lcd_display::LcdDisplay;

/// CPU→IO `17h`（LCD 制御）。
pub const CMD_LCD_CTRL: u8 = 0x17;
/// CPU→IO `18h`（LCD 文字列）。
pub const CMD_LCD_TEXT: u8 = 0x18;

/// `17h` の kind=0（Clear）。
pub const LCD_CTRL_CLEAR: u8 = 0;
/// `17h` の kind=1（Home）。
pub const LCD_CTRL_HOME: u8 = 1;
/// `17h` の kind=2（DisplayCtrl）。
pub const LCD_CTRL_DISPLAY: u8 = 2;
/// `17h` の kind=3（SetCursor）。
pub const LCD_CTRL_SET_CURSOR: u8 = 3;

/// LCD 向けコマンドなら処理して status を返す。
///
/// - `Some(status)`: LCD コマンドとして処理済み
/// - `None`: LCD 以外のコマンド
pub fn dispatch_lcd_frame(frame: &[u8], lcd: &mut LcdDisplay) -> Option<u8> {
	if frame.is_empty() {
		return Some(response::NG);
	}
	match frame[0] {
		CMD_LCD_CTRL => Some(handle_lcd_control_frame(frame, lcd)),
		CMD_LCD_TEXT => Some(handle_lcd_text_frame(frame, lcd)),
		_ => None,
	}
}

/// HandShake `17h` フレームを処理する。
pub fn handle_lcd_control_frame(frame: &[u8], lcd: &mut LcdDisplay) -> u8 {
	if frame.len() < 6 {
		return response::NG;
	}
	let kind = frame[2];
	let arg_a = frame[3];
	let arg_b = frame[4];
	let arg_c = frame[5];
	match kind {
		LCD_CTRL_CLEAR => {
			lcd.clear();
			response::OK
		}
		LCD_CTRL_HOME => {
			lcd.home();
			response::OK
		}
		LCD_CTRL_DISPLAY => {
			lcd.set_display_control(arg_a);
			response::OK
		}
		LCD_CTRL_SET_CURSOR => {
			if lcd.set_cursor(arg_b, arg_c) {
				response::OK
			} else {
				response::NG
			}
		}
		_ => response::NG,
	}
}

/// HandShake `18h` フレームを処理する。
pub fn handle_lcd_text_frame(frame: &[u8], lcd: &mut LcdDisplay) -> u8 {
	if frame.len() < 4 {
		return response::NG;
	}
	let row = frame[1];
	let col = frame[2];
	let len = frame[3] as usize;
	if len > 16 {
		return response::NG;
	}
	let end = 4usize.saturating_add(len);
	let data_end = end.min(frame.len());
	let data = if data_end > 4 {
		&frame[4..data_end]
	} else {
		&[]
	};
	if lcd.write_text_ascii(row, col, data) {
		response::OK
	} else {
		response::NG
	}
}

#[cfg(test)]
mod tests {
	use super::*;

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
