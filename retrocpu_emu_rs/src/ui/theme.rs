//! IO ボード画面の egui テーマ（`retrocpu_emu_ts` の `index.css` 相当）。

use egui::{Color32, Context, FontFamily, FontId, Stroke, TextStyle, Visuals};

/// TS 版 IO ボード画面の色・フォント。
pub struct IoBoardTheme;

impl IoBoardTheme {
	/// ページ背景（`body` 相当）。
	pub const PAGE_BG: Color32 = Color32::from_rgb(0x14, 0x15, 0x17);
	/// シェル外枠。
	pub const SHELL_BORDER: Color32 = Color32::from_rgb(0x59, 0x63, 0x6f);
	/// シェル背景。
	pub const SHELL_BG: Color32 = Color32::from_rgb(0x26, 0x2a, 0x30);
	/// パネル背景。
	pub const PANEL_BG: Color32 = Color32::from_rgb(0x2a, 0x2f, 0x36);
	/// パネル枠。
	pub const PANEL_BORDER: Color32 = Color32::from_rgb(0x4f, 0x5b, 0x68);
	/// LED カード背景。
	pub const LED_CARD_BG: Color32 = Color32::from_rgb(0x1a, 0x1f, 0x25);
	/// LED カード枠。
	pub const LED_CARD_BORDER: Color32 = Color32::from_rgb(0x52, 0x5e, 0x6c);
	/// IO ボードシェル幅（TS `.emu-shell` 720px）。
	pub const PANEL_WIDTH: f32 = 720.0;
	/// セクション見出し。
	pub const SECTION_TITLE: Color32 = Color32::from_rgb(0xb9, 0xc9, 0xda);
	/// 本文。
	pub const TEXT: Color32 = Color32::from_rgb(0xec, 0xe9, 0xdd);

	/// egui 全体にダーク IO ボード風スタイルを適用する。
	pub fn apply(ctx: &Context) {
		let mut visuals = Visuals::dark();
		visuals.panel_fill = Self::PAGE_BG;
		visuals.window_fill = Self::PAGE_BG;
		visuals.extreme_bg_color = Self::PAGE_BG;
		visuals.faint_bg_color = Self::LED_CARD_BG;
		visuals.widgets.noninteractive.bg_fill = Self::PANEL_BG;
		visuals.widgets.inactive.bg_fill = Color32::from_rgb(0x33, 0x33, 0x33);
		visuals.widgets.hovered.bg_fill = Color32::from_rgb(0x44, 0x44, 0x44);
		visuals.widgets.active.bg_fill = Color32::from_rgb(0xff, 0x00, 0x00);
		visuals.selection.bg_fill = Color32::from_rgb(0x00, 0x88, 0xff);
		visuals.override_text_color = Some(Self::TEXT);
		ctx.set_visuals(visuals);
		ctx.style_mut_of(egui::Theme::Dark, |style| {
			style.text_styles.insert(
				TextStyle::Body,
				FontId::new(14.0, FontFamily::Monospace),
			);
			style.text_styles.insert(
				TextStyle::Button,
				FontId::new(14.0, FontFamily::Monospace),
			);
			style.text_styles.insert(
				TextStyle::Heading,
				FontId::new(16.0, FontFamily::Monospace),
			);
		});
	}

	/// シェル用の外枠スタイル。
	pub fn shell_frame() -> egui::Frame {
		egui::Frame::new()
			.fill(Self::SHELL_BG)
			.stroke(Stroke::new(2.0, Self::SHELL_BORDER))
			.corner_radius(16.0)
			.inner_margin(16.0)
	}

	/// ヘッダ／メイン用パネル枠。
	pub fn panel_frame() -> egui::Frame {
		egui::Frame::new()
			.fill(Self::PANEL_BG)
			.stroke(Stroke::new(1.0, Self::PANEL_BORDER))
			.corner_radius(10.0)
			.inner_margin(12.0)
	}

	/// 7セグ／砲弾／LCD カード枠。
	pub fn led_card_frame() -> egui::Frame {
		egui::Frame::new()
			.fill(Self::LED_CARD_BG)
			.stroke(Stroke::new(1.0, Self::LED_CARD_BORDER))
			.corner_radius(8.0)
			.inner_margin(10.0)
	}
}
