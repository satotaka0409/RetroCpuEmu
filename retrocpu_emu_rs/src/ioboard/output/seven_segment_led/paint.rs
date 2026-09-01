//! 1 桁分の 7セグ（矩形セグメント + 小数点）を egui で描く。
//!
//! 幾何は `retrocpu_emu_ts/src/renderer/seven_segment.ts` と同じ（台形ではなく矩形）。

use egui::{epaint::CircleShape, Color32, Pos2, Rect, Shape, Stroke, Ui, Vec2};

use super::pattern::{segment_on, SEG_A, SEG_B, SEG_C, SEG_D, SEG_DP, SEG_E, SEG_F, SEG_G};

/// 1 桁およびバンクの見た目。単位は論理ピクセル。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SevenSegmentStyle {
	/// 1 桁の幅（小数点用の余白を含む）。既定 36。
	pub digit_width: f32,
	/// 1 桁の高さ。既定 72。
	pub digit_height: f32,
	/// セグメントの太さ。既定 7。
	pub thickness: f32,
	/// 桁同士の隙間。既定 8。
	pub digit_gap: f32,
	/// 点灯色。既定 `#ff3b1f`。
	pub on: Color32,
	/// 消灯色（暗いセグメント外形）。既定は低不透明度の灰。
	pub off: Color32,
	/// 1 桁の背景。既定 `#1a0d0b`。
	pub digit_bg: Color32,
	/// ADDR/DATA バンクの背景。既定 `#120d0a`。
	pub bank_bg: Color32,
	/// バンク枠線。既定 `#5a3b2e`。
	pub bank_border: Color32,
	/// キャプション色。既定 `#91a4b8`。
	pub caption: Color32,
}

impl Default for SevenSegmentStyle {
	fn default() -> Self {
		Self {
			digit_width: 36.0,
			digit_height: 72.0,
			thickness: 7.0,
			digit_gap: 8.0,
			on: Color32::from_rgb(0xff, 0x3b, 0x1f),
			off: Color32::from_rgba_unmultiplied(0x33, 0x33, 0x33, 0x55),
			digit_bg: Color32::from_rgb(0x1a, 0x0d, 0x0b),
			bank_bg: Color32::from_rgb(0x12, 0x0d, 0x0a),
			bank_border: Color32::from_rgb(0x5a, 0x3b, 0x2e),
			caption: Color32::from_rgb(0x91, 0xa4, 0xb8),
		}
	}
}

/// 点灯セグメントのグロー用ストローク色を作る。
fn glow_stroke(on: Color32) -> Stroke {
	let [r, g, b, _] = on.to_array();
	Stroke::new(2.4, Color32::from_rgba_unmultiplied(r, g, b, 90))
}

/// 1 セグメント（矩形）を塗る。
fn paint_rect_seg(ui: &Ui, rect: Rect, on: bool, style: &SevenSegmentStyle, radius: f32) {
	let painter = ui.painter();
	let fill = if on { style.on } else { style.off };
	let stroke = if on {
		glow_stroke(style.on)
	} else {
		Stroke::NONE
	};
	painter.rect_filled(rect, radius, fill);
	if on {
		painter.rect_stroke(rect, radius, stroke, egui::StrokeKind::Inside);
	}
}

/// 1 桁分の矩形へ 8bit パターンを描く（TS `createSevenSegment` 相当）。
///
/// `rect` は 1 桁全体（右端に dp 用余白を含む）。`pattern` は bit0=a … bit7=dp。
pub fn paint_digit(ui: &Ui, rect: Rect, pattern: u8, style: &SevenSegmentStyle) {
	let painter = ui.painter();
	painter.rect_filled(rect, 4.0, style.digit_bg);

	let t = style.thickness;
	let w = style.digit_width;
	let h = rect.height();
	let r = (t * 0.5).max(1.0);
	let x = rect.left();
	let y = rect.top();
	let half_h = h * 0.5;

	// a — 上
	paint_rect_seg(
		ui,
		Rect::from_min_size(Pos2::new(x + t, y), Vec2::new((w - 2.0 * t).max(t), t)),
		segment_on(pattern, SEG_A),
		style,
		r,
	);
	// b — 右上
	paint_rect_seg(
		ui,
		Rect::from_min_size(
			Pos2::new(x + w - t, y + t),
			Vec2::new(t, (half_h - t).max(t)),
		),
		segment_on(pattern, SEG_B),
		style,
		r,
	);
	// c — 右下
	paint_rect_seg(
		ui,
		Rect::from_min_size(
			Pos2::new(x + w - t, y + half_h),
			Vec2::new(t, (half_h - t).max(t)),
		),
		segment_on(pattern, SEG_C),
		style,
		r,
	);
	// d — 下
	paint_rect_seg(
		ui,
		Rect::from_min_size(
			Pos2::new(x + t, y + h - t),
			Vec2::new((w - 2.0 * t).max(t), t),
		),
		segment_on(pattern, SEG_D),
		style,
		r,
	);
	// e — 左下
	paint_rect_seg(
		ui,
		Rect::from_min_size(
			Pos2::new(x, y + half_h),
			Vec2::new(t, (half_h - t).max(t)),
		),
		segment_on(pattern, SEG_E),
		style,
		r,
	);
	// f — 左上
	paint_rect_seg(
		ui,
		Rect::from_min_size(
			Pos2::new(x, y + t),
			Vec2::new(t, (half_h - t).max(t)),
		),
		segment_on(pattern, SEG_F),
		style,
		r,
	);
	// g — 中
	paint_rect_seg(
		ui,
		Rect::from_min_size(
			Pos2::new(x + t, y + half_h - t * 0.5),
			Vec2::new((w - 2.0 * t).max(t), t),
		),
		segment_on(pattern, SEG_G),
		style,
		r,
	);

	let dp_r = (t * 0.4).max(2.0);
	let dp_c = Pos2::new(x + w - t * 1.2 + 8.0, y + h - t * 1.2 + 8.0);
	let dp_on = segment_on(pattern, SEG_DP);
	let dp_fill = if dp_on { style.on } else { style.off };
	painter.add(Shape::Circle(CircleShape {
		center: dp_c,
		radius: dp_r,
		fill: dp_fill,
		stroke: if dp_on {
			glow_stroke(style.on)
		} else {
			Stroke::NONE
		},
	}));
}

/// 横一列の桁を描き、確保した領域の応答を返す。
///
/// `patterns` は左から右。各要素は 8bit。
pub fn paint_digit_row(ui: &mut Ui, patterns: &[u8], style: &SevenSegmentStyle) -> egui::Response {
	let n = patterns.len().max(1);
	let w = style.digit_width * n as f32 + style.digit_gap * (n.saturating_sub(1) as f32);
	let size = Vec2::new(w, style.digit_height);
	let (rect, response) = ui.allocate_exact_size(size, egui::Sense::hover());

	let mut x = rect.left();
	for &pat in patterns {
		let digit = Rect::from_min_size(
			Pos2::new(x, rect.top()),
			Vec2::new(style.digit_width, style.digit_height),
		);
		paint_digit(ui, digit, pat, style);
		x += style.digit_width + style.digit_gap;
	}
	response
}
