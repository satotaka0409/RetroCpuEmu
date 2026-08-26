//! ADDR 8 桁 + DATA 4 桁の 7セグパネル。

use egui::{Frame, RichText, Stroke, Ui, Widget};

use super::paint::{paint_digit_row, SevenSegmentStyle};
use super::pattern::{
	hex_nibble_to_seg_with_dp, word_to_seg_digits, word_to_seg_digits_padded, ADDR_DIGIT_COUNT,
	DATA_DIGIT_COUNT, DIGIT_COUNT, SEG_DP,
};

/// IO ボードの 7セグ表示（アドレス部 8 桁 + データ部 4 桁）。
///
/// 各桁は 8bit（bit0=a … bit6=g, bit7=dp）。ハンドシェイク `16h` の 12 バイトと
/// 同じ並び（0..7 = ADDR、8..11 = DATA）。
#[derive(Debug, Clone, PartialEq)]
pub struct SevenSegmentLed {
	patterns: [u8; DIGIT_COUNT],
	style: SevenSegmentStyle,
}

impl Default for SevenSegmentLed {
	fn default() -> Self {
		Self::new()
	}
}

impl SevenSegmentLed {
	/// 全消灯のパネルを作る。
	pub fn new() -> Self {
		Self {
			patterns: [0; DIGIT_COUNT],
			style: SevenSegmentStyle::default(),
		}
	}

	/// 見た目を差し替える。
	pub fn with_style(mut self, style: SevenSegmentStyle) -> Self {
		self.style = style;
		self
	}

	/// 現在のスタイル。
	pub fn style(&self) -> SevenSegmentStyle {
		self.style
	}

	/// スタイルを書き換える。
	pub fn set_style(&mut self, style: SevenSegmentStyle) {
		self.style = style;
	}

	/// 12 桁すべての 8bit パターン（ADDR 8 + DATA 4）。
	pub fn patterns(&self) -> &[u8; DIGIT_COUNT] {
		&self.patterns
	}

	/// ADDR 部 8 桁（左が上位）。
	pub fn addr_patterns(&self) -> &[u8] {
		&self.patterns[..ADDR_DIGIT_COUNT]
	}

	/// DATA 部 4 桁（左が上位）。
	pub fn data_patterns(&self) -> &[u8] {
		&self.patterns[ADDR_DIGIT_COUNT..]
	}

	/// 1 桁の 8bit パターンを書く。
	///
	/// `index` は 0..11（0..7=ADDR、8..11=DATA）。範囲外は無視する。
	pub fn set_digit(&mut self, index: usize, pattern: u8) {
		if let Some(slot) = self.patterns.get_mut(index) {
			*slot = pattern;
		}
	}

	/// ハンドシェイク `16h` と同じ 12 バイトを一括で載せる。
	///
	/// `bytes` が 12 未満なら残りは消灯。12 を超える分は捨てる。
	pub fn set_patterns(&mut self, bytes: &[u8]) {
		self.patterns.fill(0);
		let n = bytes.len().min(DIGIT_COUNT);
		self.patterns[..n].copy_from_slice(&bytes[..n]);
	}

	/// 1 桁を 16 進ニブルで点灯する。
	///
	/// `nibble` は下位 4bit。`dp` が真なら小数点も点灯。
	pub fn set_digit_hex(&mut self, index: usize, nibble: u8, dp: bool) {
		self.set_digit(index, hex_nibble_to_seg_with_dp(nibble, dp));
	}

	/// ADDR 8 桁を 32bit 値の 16 進表示にする（上位 0 埋め。dp は消灯）。
	pub fn set_addr_hex(&mut self, value: u32) {
		let digits = word_to_seg_digits(value, ADDR_DIGIT_COUNT);
		self.patterns[..ADDR_DIGIT_COUNT].copy_from_slice(&digits);
	}

	/// DATA 4 桁を 16bit 値の 16 進表示にする（上位 0 埋め。dp は消灯）。
	pub fn set_data_hex(&mut self, value: u16) {
		let digits = word_to_seg_digits(value as u32, DATA_DIGIT_COUNT);
		self.patterns[ADDR_DIGIT_COUNT..].copy_from_slice(&digits);
	}

	/// ADDR を設定桁数だけ点灯する（未使用の上位桁は消灯）。
	///
	/// `used_digits` は 1〜8。IO ボード設定エリアの ADDR 桁数に相当。
	pub fn set_addr_hex_padded(&mut self, value: u32, used_digits: usize) {
		let digits = word_to_seg_digits_padded(value, used_digits, ADDR_DIGIT_COUNT);
		self.patterns[..ADDR_DIGIT_COUNT].copy_from_slice(&digits);
	}

	/// DATA を設定桁数だけ点灯する（未使用の上位桁は消灯）。
	///
	/// `used_digits` は 1〜4。IO ボード設定エリアの DATA 桁数に相当。
	pub fn set_data_hex_padded(&mut self, value: u16, used_digits: usize) {
		let digits = word_to_seg_digits_padded(value as u32, used_digits, DATA_DIGIT_COUNT);
		self.patterns[ADDR_DIGIT_COUNT..].copy_from_slice(&digits);
	}

	/// 指定桁の小数点だけ立てる／下ろす。a..g は変えない。
	///
	/// `index` が範囲外なら何もしない。
	pub fn set_dp(&mut self, index: usize, on: bool) {
		if let Some(slot) = self.patterns.get_mut(index) {
			if on {
				*slot |= SEG_DP;
			} else {
				*slot &= !SEG_DP;
			}
		}
	}

	/// ADDR + DATA を egui 上に描く。
	pub fn show(&self, ui: &mut Ui) -> egui::Response {
		let inner = ui.horizontal(|ui| {
			self.paint_bank(ui, "ADDRESS", self.addr_patterns());
			ui.add_space(18.0);
			self.paint_bank(ui, "DATA", self.data_patterns());
		});
		inner.response
	}

	/// ADDR/DATA 片方のバンク（暗い枠 + 桁 + キャプション）を描く。
	fn paint_bank(&self, ui: &mut Ui, caption: &str, patterns: &[u8]) {
		ui.vertical(|ui| {
			Frame::new()
				.fill(self.style.bank_bg)
				.stroke(Stroke::new(1.0, self.style.bank_border))
				.corner_radius(8.0)
				.inner_margin(10.0)
				.show(ui, |ui| {
					paint_digit_row(ui, patterns, &self.style);
				});
			ui.add_space(4.0);
			ui.label(
				RichText::new(caption)
					.size(11.0)
					.color(self.style.caption)
					.extra_letter_spacing(1.6),
			);
		});
	}
}

impl Widget for &SevenSegmentLed {
	/// パネルを 1 ウィジェットとして置く。
	fn ui(self, ui: &mut Ui) -> egui::Response {
		self.show(ui)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::ioboard::output::seven_segment_led::pattern::hex_nibble_to_seg;

	#[test]
	fn hex_addr_data_layout() {
		let mut led = SevenSegmentLed::new();
		led.set_addr_hex(0x0000_0108);
		led.set_data_hex(0xabcd);
		assert_eq!(led.addr_patterns()[7], hex_nibble_to_seg(0x8));
		assert_eq!(led.addr_patterns()[6], hex_nibble_to_seg(0x0));
		assert_eq!(
			led.data_patterns(),
			&[
				hex_nibble_to_seg(0xa),
				hex_nibble_to_seg(0xb),
				hex_nibble_to_seg(0xc),
				hex_nibble_to_seg(0xd),
			]
		);
	}

	#[test]
	fn set_patterns_copies_twelve_bytes() {
		let mut led = SevenSegmentLed::new();
		led.set_patterns(&[
			0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c,
		]);
		assert_eq!(led.patterns()[0], 0x3f);
		assert_eq!(led.patterns()[11], 0x7c);
		led.set_patterns(&[0xff]);
		assert_eq!(led.patterns()[0], 0xff);
		assert_eq!(led.patterns()[1], 0);
	}

	#[test]
	fn dp_toggles_bit7_only() {
		let mut led = SevenSegmentLed::new();
		led.set_digit_hex(11, 0xa, false);
		let body = led.patterns()[11];
		led.set_dp(11, true);
		assert_eq!(led.patterns()[11], body | SEG_DP);
		led.set_dp(11, false);
		assert_eq!(led.patterns()[11], body);
	}
}
