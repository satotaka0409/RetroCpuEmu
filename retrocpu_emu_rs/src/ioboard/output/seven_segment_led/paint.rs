//! 1 桁分の 7セグ（台形セグメント + 小数点）を egui で描く。

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

/// 水平セグメント（a / g / d）の 6 頂点。左上原点、長さ `len`、太さ `t`。
fn horiz_seg(origin: Pos2, len: f32, t: f32) -> [Pos2; 6] {
	let m = t * 0.5;
	let x = origin.x;
	let y = origin.y;
	[
		Pos2::new(x + m, y),
		Pos2::new(x + len - m, y),
		Pos2::new(x + len, y + m),
		Pos2::new(x + len - m, y + t),
		Pos2::new(x + m, y + t),
		Pos2::new(x, y + m),
	]
}

/// 垂直セグメント（b / c / e / f）の 6 頂点。左上原点、長さ `len`、太さ `t`。
fn vert_seg(origin: Pos2, len: f32, t: f32) -> [Pos2; 6] {
	let m = t * 0.5;
	let x = origin.x;
	let y = origin.y;
	[
		Pos2::new(x + m, y),
		Pos2::new(x + t, y + m),
		Pos2::new(x + t, y + len - m),
		Pos2::new(x + m, y + len),
		Pos2::new(x, y + len - m),
		Pos2::new(x, y + m),
	]
}

/// 点灯セグメントのグロー用ストローク色を作る。
fn glow_stroke(on: Color32) -> Stroke {
	let [r, g, b, _] = on.to_array();
	Stroke::new(2.4, Color32::from_rgba_unmultiplied(r, g, b, 90))
}

/// 1 セグメント（凸 6 角形）を塗る。
fn paint_polygon(ui: &Ui, pts: [Pos2; 6], on: bool, style: &SevenSegmentStyle) {
	let painter = ui.painter();
	let fill = if on { style.on } else { style.off };
	let stroke = if on {
		glow_stroke(style.on)
	} else {
		Stroke::NONE
	};
	painter.add(Shape::convex_polygon(pts.to_vec(), fill, stroke));
}

/// 1 桁分の矩形へ 8bit パターンを描く。
///
/// `rect` は 1 桁全体（右端に dp 用余白を含む）。`pattern` は bit0=a … bit7=dp。
///
/// # Arguments
/// - `ui`: 関数に渡す値
/// - `rect`: 関数に渡す値
/// - `pattern`: 関数に渡す値
/// - `style`: 関数に渡す値
pub fn paint_digit(ui: &Ui, rect: Rect, pattern: u8, style: &SevenSegmentStyle) {
	let painter = ui.painter();
	painter.rect_filled(rect, 4.0, style.digit_bg);

	let pad = (style.thickness * 0.25).clamp(1.0, 4.0);
	let body = Rect::from_min_max(
		rect.min + Vec2::new(pad, pad),
		Pos2::new(rect.right() - style.thickness * 1.35, rect.bottom() - pad),
	);
	let t = style
		.thickness
		.min(body.width() * 0.28)
		.min(body.height() * 0.14);
	let gap = (t * 0.18).max(0.8);
	let inner_w = (body.width() - t).max(t * 2.0);
	let half_h = (body.height() * 0.5 - t * 0.5).max(t * 2.0);
	let vert_len = (half_h - gap).max(t);

	let x0 = body.left();
	let y0 = body.top();
	let x1 = body.left() + inner_w;
	let y_mid = body.center().y - t * 0.5;
	let y_bot = body.bottom() - t;

	paint_polygon(
		ui,
		horiz_seg(
			Pos2::new(x0 + t * 0.5 + gap, y0),
			inner_w - t - gap * 2.0,
			t,
		),
		segment_on(pattern, SEG_A),
		style,
	);
	paint_polygon(
		ui,
		vert_seg(Pos2::new(x1, y0 + t * 0.5 + gap), vert_len, t),
		segment_on(pattern, SEG_B),
		style,
	);
	paint_polygon(
		ui,
		vert_seg(Pos2::new(x1, y_mid + t * 0.5 + gap), vert_len, t),
		segment_on(pattern, SEG_C),
		style,
	);
	paint_polygon(
		ui,
		horiz_seg(
			Pos2::new(x0 + t * 0.5 + gap, y_bot),
			inner_w - t - gap * 2.0,
			t,
		),
		segment_on(pattern, SEG_D),
		style,
	);
	paint_polygon(
		ui,
		vert_seg(Pos2::new(x0, y_mid + t * 0.5 + gap), vert_len, t),
		segment_on(pattern, SEG_E),
		style,
	);
	paint_polygon(
		ui,
		vert_seg(Pos2::new(x0, y0 + t * 0.5 + gap), vert_len, t),
		segment_on(pattern, SEG_F),
		style,
	);
	paint_polygon(
		ui,
		horiz_seg(
			Pos2::new(x0 + t * 0.5 + gap, y_mid),
			inner_w - t - gap * 2.0,
			t,
		),
		segment_on(pattern, SEG_G),
		style,
	);

	let dp_r = (t * 0.42).max(2.0);
	let dp_c = Pos2::new(rect.right() - dp_r - pad * 0.4, body.bottom() - dp_r);
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
///
/// # Arguments
/// - `ui`: 関数に渡す値
/// - `patterns`: 関数に渡す値
/// - `style`: 関数に渡す値
///
/// # Returns
/// - `egui::Response` を返します。
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
