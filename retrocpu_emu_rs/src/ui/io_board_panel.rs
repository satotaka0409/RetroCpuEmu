//! IO ボード画面全体（`retrocpu_emu_ts/src/renderer/index.html` 相当）。

use egui::{RichText, ScrollArea, Ui};

use crate::board_link::CpuBoardAgent;
use crate::ioboard::output::seven_segment_led::SevenSegmentStyle;
use crate::ioboard::IoBoard;
use crate::ui::hex_keyboard::HexKeyboardUi;
use crate::ui::lcd1602::show_lcd_card;
use crate::ui::theme::IoBoardTheme;

/// 7セグ／砲弾 LED カード内の区切り（従来の約 1/3）。
const LED_SECTION_GAP: f32 = 5.0;

/// IO ボードパネル UI 状態。
pub struct IoBoardPanel {
	keyboard: HexKeyboardUi,
}

impl Default for IoBoardPanel {
	fn default() -> Self {
		Self::new()
	}
}

impl IoBoardPanel {
	/// 空のキーボード状態で作る。
	pub fn new() -> Self {
		Self {
			keyboard: HexKeyboardUi::new(),
		}
	}

	/// TS 版と同じ縦型 IO ボード画面を描画する。
	pub fn show<A: CpuBoardAgent>(&mut self, ui: &mut Ui, io: &mut IoBoard<A>) {
		let time_secs = ui.input(|i| i.time);
		let snap = io.snapshot();

		ScrollArea::vertical()
			.auto_shrink([false; 2])
			.show(ui, |ui| {
				ui.with_layout(
					egui::Layout::top_down(egui::Align::Center),
					|ui| {
						ui.set_max_width(IoBoardTheme::PANEL_WIDTH);
						IoBoardTheme::shell_frame().show(ui, |ui| {
							ui.spacing_mut().item_spacing.y = 14.0;

							IoBoardTheme::panel_frame().show(ui, |ui| {
								ui.label(
									RichText::new("IO Board")
										.text_style(egui::TextStyle::Heading)
										.extra_letter_spacing(0.8),
								);
							});

							IoBoardTheme::panel_frame().show(ui, |ui| {
								ui.spacing_mut().item_spacing.y = 14.0;

								IoBoardTheme::led_card_frame().show(ui, |ui| {
									ui.with_layout(
										egui::Layout::top_down(egui::Align::Min),
										|ui| {
											ui.label(
												RichText::new("7-Segment (ADDR 8 + DATA 4)")
													.size(12.0)
													.color(IoBoardTheme::SECTION_TITLE)
													.extra_letter_spacing(0.8),
											);
											ui.add_space(4.0);
											let mut seven = io.seven_seg().clone();
											seven.set_style(SevenSegmentStyle {
												digit_width: 29.25,
												digit_height: 60.0,
												thickness: 4.0,
												digit_gap: 4.0,
												..SevenSegmentStyle::default()
											});
											ui.with_layout(
												egui::Layout::top_down(egui::Align::Center),
												|ui| {
													seven.show_io_board_layout(ui, io.bullet());
												},
											);

											ui.add_space(LED_SECTION_GAP);

											ui.label(
												RichText::new("Bullet LEDs (0–A)")
													.size(12.0)
													.color(IoBoardTheme::SECTION_TITLE)
													.extra_letter_spacing(0.8),
											);
											ui.add_space(2.0);
											io.bullet().show_user_row(ui);
										},
									);
								});

								show_lcd_card(ui, &snap.lcd, time_secs);

								self.keyboard.show_centered(ui, io, time_secs);
							});
						});
					},
				);
			});
	}
}
