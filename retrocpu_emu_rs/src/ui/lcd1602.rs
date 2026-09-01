//! LCD1602 風 egui ウィジェット（`retrocpu_emu_ts/src/renderer/lcd1602.css` 相当）。

use egui::{
	epaint::Mesh, Align2, Color32, FontId, Pos2, Rect, RichText, Shape, Stroke, Ui, Vec2,
};

use crate::ioboard::output::lcd_display::{LcdDisplaySnapshot, LCD_COLS, LCD_ROWS};
use crate::ui::theme::IoBoardTheme;

/// 1 セルの幅（CSS `.lcd1602-cell`）。
const CELL_W: f32 = 14.0;
/// 1 セルの高さ（CSS `.lcd1602-cell`）。
const CELL_H: f32 = 22.0;
/// セル間隔（CSS `.lcd1602-line` gap）。
const CELL_GAP: f32 = 3.0;
/// 行間隔（CSS `.lcd1602-screen` gap）。
const LINE_GAP: f32 = 4.0;

const MODULE_TOP: Color32 = Color32::from_rgb(0x3a, 0x42, 0x4a);
const MODULE_BOTTOM: Color32 = Color32::from_rgb(0x2a, 0x30, 0x36);
const MODULE_BORDER: Color32 = Color32::from_rgb(0x5a, 0x65, 0x70);
const BEZEL_BG: Color32 = Color32::from_rgb(0x1a, 0x22, 0x14);
const BEZEL_BORDER: Color32 = Color32::from_rgb(0x0d, 0x12, 0x0c);
const BEZEL_INSET: Color32 = Color32::from_rgb(0x4a, 0x5c, 0x32);
const SCREEN_TOP: Color32 = Color32::from_rgb(0x9d, 0xb5, 0x6a);
const SCREEN_BOTTOM: Color32 = Color32::from_rgb(0x87, 0xa0, 0x50);
const SCREEN_BORDER: Color32 = Color32::from_rgb(0x6d, 0x85, 0x40);
const TEXT_COLOR: Color32 = Color32::from_rgb(0x1c, 0x33, 0x0e);
const CURSOR_COLOR: Color32 = Color32::from_rgb(0x1c, 0x33, 0x0e);

const MODULE_PAD_X: f32 = 14.0;
const MODULE_PAD_Y: f32 = 4.0;
const BEZEL_PAD_X: f32 = 12.0;
const BEZEL_PAD_Y: f32 = 10.0;
const SCREEN_PAD_X: f32 = 10.0;
const SCREEN_PAD_Y: f32 = 8.0;

/// 文字グリッド部分のサイズ（padding 除く）。
fn screen_content_size() -> Vec2 {
	Vec2::new(
		LCD_COLS as f32 * CELL_W + (LCD_COLS.saturating_sub(1) as f32) * CELL_GAP,
		LCD_ROWS as f32 * CELL_H + (LCD_ROWS.saturating_sub(1) as f32) * LINE_GAP,
	)
}

/// モジュール全体の外寸（枠線・padding 込み）。
fn module_outer_size() -> Vec2 {
	let screen = screen_content_size();
	Vec2::new(
		screen.x + SCREEN_PAD_X * 2.0 + BEZEL_PAD_X * 2.0 + MODULE_PAD_X * 2.0,
		screen.y + SCREEN_PAD_Y * 2.0 + BEZEL_PAD_Y * 2.0 + MODULE_PAD_Y * 2.0,
	)
}

/// 縦方向 2 色グラデーション矩形を描く。
fn paint_vertical_gradient(ui: &Ui, rect: Rect, top: Color32, bottom: Color32) {
	let painter = ui.painter();
	let mut mesh = Mesh::default();
	let lt = mesh.vertices.len() as u32;
	mesh.colored_vertex(rect.left_top(), top);
	let rt = mesh.vertices.len() as u32;
	mesh.colored_vertex(rect.right_top(), top);
	let rb = mesh.vertices.len() as u32;
	mesh.colored_vertex(rect.right_bottom(), bottom);
	let lb = mesh.vertices.len() as u32;
	mesh.colored_vertex(rect.left_bottom(), bottom);
	mesh.add_triangle(lt, rt, rb);
	mesh.add_triangle(lt, rb, lb);
	painter.add(Shape::mesh(mesh));
}

/// CSS `.lcd1602-cell` の半透明背景色。
fn cell_bg() -> Color32 {
	Color32::from_rgba_unmultiplied(30, 48, 12, 26)
}

/// 1 セルを CSS `.lcd1602-cell` 相当で描く。
fn paint_cell(ui: &Ui, rect: Rect, ch: char, cursor_visible: bool) {
	let painter = ui.painter();
	painter.rect_filled(rect, 0.0, cell_bg());
	if cursor_visible {
		let bar_h = 3.0;
		let bar = Rect::from_min_max(
			Pos2::new(rect.left(), rect.bottom() - bar_h),
			rect.right_bottom(),
		);
		painter.rect_filled(bar, 0.0, CURSOR_COLOR);
	}
	painter.text(
		rect.center(),
		Align2::CENTER_CENTER,
		ch.to_string(),
		FontId::monospace(15.0),
		TEXT_COLOR,
	);
}

/// LCD スクリーン（2 行 × 16 セル）を描く。
fn paint_screen(ui: &Ui, rect: Rect, snap: &LcdDisplaySnapshot, blink_phase_on: bool) {
	paint_vertical_gradient(ui, rect, SCREEN_TOP, SCREEN_BOTTOM);
	ui.painter().rect_stroke(rect, 2.0, Stroke::new(1.0, SCREEN_BORDER), egui::StrokeKind::Inside);

	let origin = rect.min + Vec2::new(SCREEN_PAD_X, SCREEN_PAD_Y);
	for row in 0..LCD_ROWS {
		let line = if snap.display_on {
			snap.lines[row].as_str()
		} else {
			"                "
		};
		for col in 0..LCD_COLS {
			let ch = line.chars().nth(col).unwrap_or(' ');
			let x = origin.x + col as f32 * (CELL_W + CELL_GAP);
			let y = origin.y + row as f32 * (CELL_H + LINE_GAP);
			let cell_rect = Rect::from_min_size(Pos2::new(x, y), Vec2::new(CELL_W, CELL_H));
			let is_cursor = snap.display_on
				&& snap.cursor_on
				&& snap.cursor_row as usize == row
				&& snap.cursor_col as usize == col;
			let cursor_visible = is_cursor && (!snap.blink_on || blink_phase_on);
			paint_cell(ui, cell_rect, ch, cursor_visible);
		}
	}
}

/// LCD1602 スナップショットを描画する。
///
/// # Arguments
/// - `ui`: 描画先
/// - `snap`: LCD 状態
/// - `time_secs`: 点滅カーソル用の経過秒（`ctx.input(|i| i.time)`）
pub fn show_lcd1602(ui: &mut Ui, snap: &LcdDisplaySnapshot, time_secs: f64) {
	let blink_phase_on = (time_secs % 1.0) < 0.5;
	let outer = module_outer_size();
	let screen_content = screen_content_size();

	let (_id, response) = ui.allocate_exact_size(outer, egui::Sense::hover());
	let module_rect = response.rect;

	paint_vertical_gradient(ui, module_rect, MODULE_TOP, MODULE_BOTTOM);
	ui.painter().rect_stroke(
		module_rect,
		8.0,
		Stroke::new(1.0, MODULE_BORDER),
		egui::StrokeKind::Outside,
	);

	let bezel_rect = module_rect.shrink2(Vec2::new(MODULE_PAD_X, MODULE_PAD_Y));
	ui.painter().rect_filled(bezel_rect, 4.0, BEZEL_BG);
	ui.painter().rect_stroke(
		bezel_rect,
		4.0,
		Stroke::new(2.0, BEZEL_BORDER),
		egui::StrokeKind::Outside,
	);
	ui.painter().rect_stroke(
		bezel_rect.shrink(1.0),
		3.0,
		Stroke::new(1.0, BEZEL_INSET),
		egui::StrokeKind::Inside,
	);

	let screen_rect = Rect::from_min_size(
		bezel_rect.min + Vec2::new(BEZEL_PAD_X, BEZEL_PAD_Y),
		screen_content + Vec2::new(SCREEN_PAD_X * 2.0, SCREEN_PAD_Y * 2.0),
	);
	paint_screen(ui, screen_rect, snap, blink_phase_on);
}

/// LCD カード（見出し付き）を描く。
pub fn show_lcd_card(ui: &mut Ui, snap: &LcdDisplaySnapshot, time_secs: f64) {
	IoBoardTheme::led_card_frame().show(ui, |ui| {
		ui.label(
			RichText::new("LCD1602")
				.size(12.0)
				.color(IoBoardTheme::SECTION_TITLE)
				.extra_letter_spacing(0.8),
		);
		ui.add_space(8.0);
		ui.horizontal(|ui| {
			let spare = (ui.available_width() - module_outer_size().x).max(0.0);
			ui.add_space(spare * 0.5);
			show_lcd1602(ui, snap, time_secs);
			ui.add_space(spare * 0.5);
		});
	});
}
