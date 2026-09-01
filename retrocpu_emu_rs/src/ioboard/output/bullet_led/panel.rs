//! 砲弾 LED 16 本（0–F）の状態と egui 配置。

use egui::{Align, Color32, Frame, Layout, RichText, Stroke, Ui, Vec2, Widget};

use super::color::{default_color_for_index, LedColor};
use super::paint::{paint_bullet_allocated, BulletLedStyle};

/// 砲弾の本数（0–F）。
pub const BULLET_COUNT: usize = 16;
/// 汎用行に出す番号の上限（0–A）。
pub const USER_LED_LAST: usize = 0x0A;
/// 砲弾 B — UNDEF（ハンドシェイク `13h`）。
pub const LED_UNDEF: usize = 0x0B;
/// 砲弾 C — RUN。
pub const LED_RUN: usize = 0x0C;
/// 砲弾 D — HALT。
pub const LED_HALT: usize = 0x0D;
/// 砲弾 E — ADDR 入力選択。
pub const LED_ADDR: usize = 0x0E;
/// 砲弾 F — DATA 入力選択。
pub const LED_DATA: usize = 0x0F;

/// ADDR / DATA 直下に置くフォーカス砲弾。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusLed {
	/// 砲弾 E（ADDR）。
	Addr,
	/// 砲弾 F（DATA）。
	Data,
}

impl FocusLed {
	/// 対応する砲弾番号（14 または 15）。
	///
	/// # Returns
	/// - 件数または長さを返します。
	pub fn index(self) -> usize {
		match self {
			Self::Addr => LED_ADDR,
			Self::Data => LED_DATA,
		}
	}
}

/// IO ボードの砲弾 LED 16 本。
///
/// 点灯ビットはハンドシェイク `16h` と同じ。下位 8bit が 0–7、上位 8bit が 8–F
///（bit0=LED8 … bit7=LEDF）。B–F の意味は `ioboard.mdc`。
#[derive(Debug, Clone, PartialEq)]
pub struct BulletLed {
	bits: u16,
	style: BulletLedStyle,
}

impl Default for BulletLed {
	fn default() -> Self {
		Self::new()
	}
}

impl BulletLed {
	/// 全消灯のパネルを作る。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			bits: 0,
			style: BulletLedStyle::default(),
		}
	}

	/// 見た目を差し替える。
	///
	/// # Arguments
	/// - `style`: 関数に渡す値
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn with_style(mut self, style: BulletLedStyle) -> Self {
		self.style = style;
		self
	}

	/// 現在のスタイル。
	///
	/// # Returns
	/// - `BulletLedStyle` を返します。
	pub fn style(&self) -> BulletLedStyle {
		self.style
	}

	/// スタイルを書き換える。
	///
	/// # Arguments
	/// - `style`: 関数に渡す値
	pub fn set_style(&mut self, style: BulletLedStyle) {
		self.style = style;
	}

	/// 16 本分のビット（bit0=LED0 … bit15=LEDF）。
	///
	/// # Returns
	/// - 16bit 値を返します。
	pub fn bits(&self) -> u16 {
		self.bits
	}

	/// 16 本分のビットを一括で載せる。
	///
	/// # Arguments
	/// - `bits`: 関数に渡す値
	pub fn set_bits(&mut self, bits: u16) {
		self.bits = bits;
	}

	/// ハンドシェイク `16h` の砲弾 2 バイトを載せる。
	///
	/// `lo` は砲弾 0–7（Bit0=LED0）。`hi` は砲弾 8–F（Bit0=LED8）。
	///
	/// # Arguments
	/// - `lo`: 関数に渡す値
	/// - `hi`: 関数に渡す値
	pub fn set_bytes(&mut self, lo: u8, hi: u8) {
		self.bits = u16::from(lo) | (u16::from(hi) << 8);
	}

	/// `16h` と同じ 2 バイト（0–7, 8–F）を返す。
	///
	/// # Returns
	/// - `(u8, u8)` を返します。
	pub fn bytes(&self) -> (u8, u8) {
		((self.bits & 0xff) as u8, (self.bits >> 8) as u8)
	}

	/// 1 本の点灯を書く。`index` が 0–15 以外なら無視する。
	///
	/// # Arguments
	/// - `index`: インデックス
	/// - `on`: 点灯フラグ
	pub fn set(&mut self, index: usize, on: bool) {
		if index >= BULLET_COUNT {
			return;
		}
		let mask = 1u16 << index;
		if on {
			self.bits |= mask;
		} else {
			self.bits &= !mask;
		}
	}

	/// 1 本が点灯しているか。範囲外は false。
	///
	/// # Arguments
	/// - `index`: インデックス
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn is_on(&self, index: usize) -> bool {
		if index >= BULLET_COUNT {
			return false;
		}
		(self.bits & (1u16 << index)) != 0
	}

	/// 番号に対するパネル既定色。
	///
	/// # Arguments
	/// - `index`: インデックス
	///
	/// # Returns
	/// - `LedColor` を返します。
	pub fn color_of(index: usize) -> LedColor {
		default_color_for_index(index)
	}

	/// 0–A の汎用行、RUN/HALT/UNDEF、ADDR/DATA フォーカスを並べて描く。
	///
	/// # Arguments
	/// - `ui`: 関数に渡す値
	///
	/// # Returns
	/// - `egui::Response` を返します。
	pub fn show(&self, ui: &mut Ui) -> egui::Response {
		let inner = ui.horizontal(|ui| {
			ui.vertical(|ui| {
				self.show_user_row(ui);
			});
			ui.add_space(16.0);
			self.show_status_col(ui);
			ui.add_space(16.0);
			ui.vertical(|ui| {
				ui.label(
					RichText::new("FOCUS")
						.size(11.0)
						.color(self.style.caption)
						.extra_letter_spacing(1.2),
				);
				ui.add_space(4.0);
				ui.horizontal(|ui| {
					ui.vertical(|ui| {
						self.show_focus(ui, FocusLed::Addr);
						ui.label(RichText::new("ADDR").size(10.0).color(self.style.caption));
					});
					ui.add_space(10.0);
					ui.vertical(|ui| {
						self.show_focus(ui, FocusLed::Data);
						ui.label(RichText::new("DATA").size(10.0).color(self.style.caption));
					});
				});
			});
		});
		inner.response
	}

	/// 0–A 行の 1 列幅（ラベル + LED）。
	fn labeled_column_width(&self) -> f32 {
		(self.style.diameter + (self.style.diameter * 0.45).max(4.0)).max(18.0)
	}

	/// 0–A 行の内容幅（枠 padding 除く）。
	pub fn user_row_content_width(&self) -> f32 {
		let n = USER_LED_LAST + 1;
		self.labeled_column_width() * n as f32 + self.style.gap * (n.saturating_sub(1) as f32)
	}

	/// 0–A 行の内容高さ（枠 padding 除く）。
	pub fn user_row_content_height(&self) -> f32 {
		let bullet_h = self.style.diameter + (self.style.diameter * 0.45).max(4.0);
		self.style.label_size + 2.0 + bullet_h
	}

	/// 砲弾 0–A（ラベル付き）を 1 行で描く。
	///
	/// # Arguments
	/// - `ui`: 関数に渡す値
	///
	/// # Returns
	/// - `egui::Response` を返します。
	pub fn show_user_row(&self, ui: &mut Ui) -> egui::Response {
		let content_w = self.user_row_content_width();
		let content_h = self.user_row_content_height();
		const FRAME_PAD: f32 = 16.0;
		let frame_w = content_w + FRAME_PAD;
		let frame_h = content_h + FRAME_PAD;
		let spare_x = (ui.available_width() - frame_w).max(0.0);

		ui.allocate_ui_with_layout(
			Vec2::new(ui.available_width(), frame_h),
			Layout::left_to_right(Align::TOP),
			|ui| {
				ui.add_space(spare_x * 0.5);
				let response = Frame::new()
					.fill(self.style.bank_bg)
					.stroke(Stroke::new(1.0, self.style.bank_border))
					.corner_radius(8.0)
					.inner_margin(8.0)
					.show(ui, |ui| {
						ui.set_min_size(Vec2::new(content_w, content_h));
						ui.set_max_size(Vec2::new(content_w, content_h));
						ui.with_layout(Layout::left_to_right(Align::TOP), |ui| {
							ui.spacing_mut().item_spacing.x = self.style.gap;
							for i in 0..=USER_LED_LAST {
								self.paint_labeled(ui, i, &format!("{i:X}"), self.style.label_color);
							}
						});
					})
					.response;
				ui.add_space(spare_x * 0.5);
				response
			},
		)
		.inner
	}

	/// RUN / HALT / UNDEF を縦に並べる（DATA 右のステータス列）。
	///
	/// # Arguments
	/// - `ui`: 関数に渡す値
	///
	/// # Returns
	/// - `egui::Response` を返します。
	pub fn show_status_col(&self, ui: &mut Ui) -> egui::Response {
		ui.vertical(|ui| {
			ui.spacing_mut().item_spacing.y = 8.0;
			self.paint_status_row(ui, LED_RUN, "RUN");
			self.paint_status_row(ui, LED_HALT, "HALT");
			self.paint_status_row(ui, LED_UNDEF, "UNDEF");
		})
		.response
	}

	/// ADDR または DATA 直下のフォーカス砲弾（ラベル無し）。
	///
	/// # Arguments
	/// - `ui`: 関数に渡す値
	/// - `which`: 関数に渡す値
	///
	/// # Returns
	/// - `egui::Response` を返します。
	pub fn show_focus(&self, ui: &mut Ui, which: FocusLed) -> egui::Response {
		let i = which.index();
		paint_bullet_allocated(ui, self.style.diameter, self.is_on(i), Self::color_of(i))
	}

	/// ラベル上・LED 下の 1 本（0–A 行用）。
	fn paint_labeled(&self, ui: &mut Ui, index: usize, label: &str, label_color: Color32) {
		let col_w = self.labeled_column_width();
		let col_h = self.user_row_content_height();
		ui.allocate_ui_with_layout(
			Vec2::new(col_w, col_h),
			Layout::top_down(Align::Center),
			|ui| {
				ui.label(
					RichText::new(label)
						.size(self.style.label_size)
						.color(label_color)
						.monospace(),
				);
				paint_bullet_allocated(
					ui,
					self.style.diameter,
					self.is_on(index),
					Self::color_of(index),
				);
			},
		);
	}

	/// LED の右にステータス名を置く 1 行。
	fn paint_status_row(&self, ui: &mut Ui, index: usize, label: &str) {
		ui.horizontal(|ui| {
			ui.spacing_mut().item_spacing.x = 8.0;
			paint_bullet_allocated(
				ui,
				self.style.diameter,
				self.is_on(index),
				Self::color_of(index),
			);
			ui.label(
				RichText::new(label)
					.size(11.0)
					.color(self.style.status_label_color)
					.extra_letter_spacing(1.0),
			);
		});
	}
}

impl Widget for &BulletLed {
	/// 16 本のパネルを 1 ウィジェットとして置く。
	fn ui(self, ui: &mut Ui) -> egui::Response {
		self.show(ui)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn bytes_roundtrip_matches_handshake_16h() {
		let mut led = BulletLed::new();
		led.set_bytes(0b0000_0101, 0b0100_0000);
		assert_eq!(led.bytes(), (0x05, 0x40));
		assert!(led.is_on(0));
		assert!(!led.is_on(1));
		assert!(led.is_on(2));
		assert!(led.is_on(LED_ADDR));
		assert!(!led.is_on(LED_DATA));
		assert!(!led.is_on(LED_RUN));
		led.set(LED_RUN, true);
		assert!(led.is_on(LED_RUN));
		assert_eq!(led.bytes().1 & (1 << (LED_RUN - 8)), 1 << 4);
	}

	#[test]
	fn out_of_range_is_ignored() {
		let mut led = BulletLed::new();
		led.set(16, true);
		led.set(99, true);
		assert_eq!(led.bits(), 0);
		assert!(!led.is_on(16));
	}

	#[test]
	fn focus_index() {
		assert_eq!(FocusLed::Addr.index(), LED_ADDR);
		assert_eq!(FocusLed::Data.index(), LED_DATA);
	}
}
