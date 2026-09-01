//! 16 進＋ファンクションキー（`retrocpu_emu_ts/src/renderer/hex_keyboard.ts` 相当）。

use std::collections::HashSet;

use egui::{Button, Color32, Frame, RichText, Sense, Ui, Vec2};

use crate::board_link::CpuBoardAgent;
use crate::ioboard::input::{FN_KEY_LABELS, HEX_KEY_ROWS, KEYBOARD_ROW_KEYS};
use crate::ioboard::monitor::ConsoleFnKey;
use crate::ioboard::IoBoard;

const LONG_PRESS_SECS: f64 = 0.7;
const HEX_KEY_SIZE: Vec2 = Vec2::new(48.0, 48.0);
const FN_KEY_SIZE: Vec2 = Vec2::new(70.0, 40.0);
/// 16 進ブロック幅（枠 padding 32 + 4 キー + 3 隙間）。
const HEX_BLOCK_WIDTH: f32 = 32.0 + 4.0 * HEX_KEY_SIZE.x + 3.0 * 8.0;
/// ファンクションブロック幅（2 キー + 1 隙間）。
const FN_BLOCK_WIDTH: f32 = 2.0 * FN_KEY_SIZE.x + 8.0;
/// 16 進列とファンクション列の間隔。
const HEX_FN_GAP: f32 = 32.0;
/// キーパッド全体幅（`hex-keyboard-root` 相当）。
pub const KEYBOARD_WIDTH: f32 = HEX_BLOCK_WIDTH + HEX_FN_GAP + FN_BLOCK_WIDTH;

/// 16 進キーボード＋ファンクションキーを描画し、入力を `IoBoard` へ渡す。
pub struct HexKeyboardUi {
	held_keys: HashSet<String>,
	fn_press_started: Option<(ConsoleFnKey, f64, bool)>,
}

impl Default for HexKeyboardUi {
	fn default() -> Self {
		Self::new()
	}
}

impl HexKeyboardUi {
	/// 空のキー状態で作る。
	pub fn new() -> Self {
		Self {
			held_keys: HashSet::new(),
			fn_press_started: None,
		}
	}

	/// TS 版 `hex-keyboard-root` と同じ配置（左 4×4 + 右 2×4）。
	pub fn show<A: CpuBoardAgent>(&mut self, ui: &mut Ui, io: &mut IoBoard<A>, time_secs: f64) {
		ui.horizontal(|ui| {
			ui.spacing_mut().item_spacing.x = HEX_FN_GAP;
			ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
				self.show_hex_block(ui, io);
			});
			ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
				ui.add_space(20.0);
				self.show_function_block(ui, io, time_secs);
			});
		});
	}

	/// 親 UI 幅の中央にキーパッドを置く。
	pub fn show_centered<A: CpuBoardAgent>(
		&mut self,
		ui: &mut Ui,
		io: &mut IoBoard<A>,
		time_secs: f64,
	) {
		let spare = (ui.available_width() - KEYBOARD_WIDTH).max(0.0);
		ui.horizontal(|ui| {
			ui.add_space(spare * 0.5);
			self.show(ui, io, time_secs);
			ui.add_space(spare * 0.5);
		});
	}

	/// 左側 16 進 4×4（`hex-keyboard` 枠）。
	fn show_hex_block<A: CpuBoardAgent>(&mut self, ui: &mut Ui, io: &mut IoBoard<A>) {
		Frame::new()
			.fill(Color32::from_rgb(0x22, 0x22, 0x22))
			.corner_radius(12.0)
			.inner_margin(16.0)
			.show(ui, |ui| {
				ui.spacing_mut().item_spacing = Vec2::new(8.0, 8.0);
				for row in HEX_KEY_ROWS {
					ui.horizontal(|ui| {
						for key in row {
							self.hex_button(ui, io, key);
						}
					});
				}
			});
	}

	/// 右側ファンクション 2×4（`function-keys-grid`）。
	fn show_function_block<A: CpuBoardAgent>(
		&mut self,
		ui: &mut Ui,
		io: &mut IoBoard<A>,
		time_secs: f64,
	) {
		ui.spacing_mut().item_spacing = Vec2::new(8.0, 8.0);
		for row in KEYBOARD_ROW_KEYS {
			ui.horizontal(|ui| {
				self.fn_button(ui, io, row[4], time_secs);
				self.fn_button(ui, io, row[5], time_secs);
			});
		}
	}

	fn hex_button<A: CpuBoardAgent>(&mut self, ui: &mut Ui, io: &mut IoBoard<A>, key: &str) {
		let btn = Button::new(RichText::new(key).size(24.0).color(Color32::WHITE))
			.min_size(HEX_KEY_SIZE)
			.fill(Color32::from_rgb(0x33, 0x33, 0x33));
		let response = ui.add(btn.sense(Sense::click()));
		self.track_key(ui, io, key, &response, Color32::from_rgb(0xff, 0x00, 0x00));
		if response.clicked() {
			if let Ok(d) = u8::from_str_radix(key, 16) {
				io.on_hex_digit(d);
			}
		}
	}

	fn fn_button<A: CpuBoardAgent>(
		&mut self,
		ui: &mut Ui,
		io: &mut IoBoard<A>,
		fn_name: &str,
		time_secs: f64,
	) {
		let Some(fn_key) = ConsoleFnKey::from_name(fn_name) else {
			return;
		};
		let label = FN_KEY_LABELS
			.iter()
			.find(|(n, _)| *n == fn_name)
			.map(|(_, l)| *l)
			.unwrap_or(fn_name);
		let btn = Button::new(
			RichText::new(label)
				.size(13.0)
				.color(Color32::WHITE)
				.extra_letter_spacing(0.4),
		)
		.min_size(FN_KEY_SIZE)
		.fill(Color32::from_rgb(0x44, 0x44, 0x44));
		let response = ui.add(btn.sense(Sense::click()));
		let down = response.is_pointer_button_down_on();

		if down {
			if self.fn_press_started.map(|(k, _, _)| k) != Some(fn_key) {
				io.on_key_matrix(fn_name, true);
				self.fn_press_started = Some((fn_key, time_secs, false));
			}
			if let Some((fk, started, fired)) = self.fn_press_started {
				if fk == fn_key && !fired && time_secs - started >= LONG_PRESS_SECS {
					if fk == ConsoleFnKey::F0 {
						let _ = io.on_ads_long_press();
					}
					self.fn_press_started = Some((fn_key, started, true));
				}
			}
			ui.painter()
				.rect_filled(response.rect, 8.0, Color32::from_rgb(0x00, 0x88, 0xff));
		} else if self.fn_press_started.map(|(k, _, _)| k) == Some(fn_key) {
			io.on_key_matrix(fn_name, false);
			let long_fired = self
				.fn_press_started
				.map(|(_, _, f)| f)
				.unwrap_or(false);
			if !long_fired && response.clicked() {
				let _ = io.on_function(fn_key);
				if fn_key == ConsoleFnKey::F5 {
					ui.ctx().request_repaint();
				}
			}
			self.fn_press_started = None;
		}
	}

	fn track_key<A: CpuBoardAgent>(
		&mut self,
		ui: &mut Ui,
		io: &mut IoBoard<A>,
		key: &str,
		response: &egui::Response,
		active_color: Color32,
	) {
		let down = response.is_pointer_button_down_on();
		let was_held = self.held_keys.contains(key);
		if down && !was_held {
			io.on_key_matrix(key, true);
			self.held_keys.insert(key.to_string());
		} else if !down && was_held {
			io.on_key_matrix(key, false);
			self.held_keys.remove(key);
		}
		if down {
			ui.painter().rect_filled(response.rect, 8.0, active_color);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn hex_rows_top_is_cdef_bottom_is_0123() {
		assert_eq!(HEX_KEY_ROWS[0], ["C", "D", "E", "F"]);
		assert_eq!(HEX_KEY_ROWS[3], ["0", "1", "2", "3"]);
	}
}
