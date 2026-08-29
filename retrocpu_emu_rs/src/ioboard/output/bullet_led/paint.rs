//! 砲弾 LED 1 個の描画（放射グラデ + グロー）。

use std::f32::consts::TAU;

use egui::{epaint::Mesh, Color32, Pos2, Rect, Sense, Shape, Stroke, Ui, Vec2};

use super::color::LedColor;

/// 砲弾 LED のサイズとバンク見た目。単位は論理ピクセル。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BulletLedStyle {
	/// 本体の直径。既定 14（TS は 12）。
	pub diameter: f32,
	/// 桁同士の隙間。既定 8。
	pub gap: f32,
	/// 16 進ラベルの文字サイズ。既定 10。
	pub label_size: f32,
	/// ラベル色。既定 `#8fa3b8`。
	pub label_color: Color32,
	/// ステータス列のラベル色。既定 `#c8d3e1`。
	pub status_label_color: Color32,
	/// 0–A 行の背景。既定 `#12161b`。
	pub bank_bg: Color32,
	/// 0–A 行の枠線。既定 `#3a4552`。
	pub bank_border: Color32,
	/// キャプション色。既定 `#91a4b8`。
	pub caption: Color32,
}

impl Default for BulletLedStyle {
	fn default() -> Self {
		Self {
			diameter: 14.0,
			gap: 8.0,
			label_size: 10.0,
			label_color: Color32::from_rgb(0x8f, 0xa3, 0xb8),
			status_label_color: Color32::from_rgb(0xc8, 0xd3, 0xe1),
			bank_bg: Color32::from_rgb(0x12, 0x16, 0x1b),
			bank_border: Color32::from_rgb(0x3a, 0x45, 0x52),
			caption: Color32::from_rgb(0x91, 0xa4, 0xb8),
		}
	}
}

const SEGMENTS: usize = 28;

/// 中心が `inner`、外周が `outer` の円盤をメッシュに足す。
fn push_radial_disc(mesh: &mut Mesh, center: Pos2, radius: f32, inner: Color32, outer: Color32) {
	let start = mesh.vertices.len() as u32;
	mesh.colored_vertex(center, inner);
	for i in 0..=SEGMENTS {
		let a = i as f32 / SEGMENTS as f32 * TAU;
		let p = center + Vec2::new(a.cos(), a.sin()) * radius;
		mesh.colored_vertex(p, outer);
	}
	for i in 0..SEGMENTS {
		mesh.add_triangle(start, start + 1 + i as u32, start + 2 + i as u32);
	}
}

/// 1 個の砲弾 LED を `rect` の中央に描く。
///
/// `rect` は直径以上の正方形を想定。`on` が真ならグロー付きで点灯。
///
/// # Arguments
/// - `ui`: 関数に渡す値
/// - `rect`: 関数に渡す値
/// - `on`: 点灯フラグ
/// - `color`: 関数に渡す値
pub fn paint_bullet(ui: &Ui, rect: Rect, on: bool, color: LedColor) {
	let painter = ui.painter();
	let r = (rect.width().min(rect.height()) * 0.5).max(2.0);
	let center = rect.center();
	let tone = color.tone();
	let mut mesh = Mesh::default();

	if on {
		push_radial_disc(&mut mesh, center, r * 1.75, tone.glow, Color32::TRANSPARENT);
		push_radial_disc(&mut mesh, center, r, tone.on_center, tone.on_edge);
		let hi = center + Vec2::new(-r * 0.22, -r * 0.28);
		push_radial_disc(
			&mut mesh,
			hi,
			r * 0.42,
			tone.on_center,
			Color32::from_rgba_unmultiplied(
				tone.on_center.r(),
				tone.on_center.g(),
				tone.on_center.b(),
				0,
			),
		);
	} else {
		push_radial_disc(&mut mesh, center, r, tone.off, tone.off);
	}

	painter.add(Shape::mesh(mesh));
	let rim = Color32::from_rgba_unmultiplied(255, 255, 255, 51);
	painter.circle_stroke(center, r, Stroke::new(1.0, rim));
}

/// 領域を確保して砲弾 1 個を描き、応答を返す。
///
/// `diameter` は本体の直径（論理ピクセル）。グロー分は内側に収める。
pub fn paint_bullet_allocated(
	ui: &mut Ui,
	diameter: f32,
	on: bool,
	color: LedColor,
) -> egui::Response {
	let pad = (diameter * 0.45).max(4.0);
	let size = Vec2::splat(diameter + pad);
	let (rect, response) = ui.allocate_exact_size(size, Sense::hover());
	let inner = Rect::from_center_size(rect.center(), Vec2::splat(diameter));
	paint_bullet(ui, inner, on, color);
	response
}
