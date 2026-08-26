//! 7セグ ADDR 8 + DATA 4 の表示確認用ウィンドウ。
//!
//! ```text
//! cargo run --example seven_segment_led
//! ```
//!
//! WSL で Wayland が壊れている場合は自動で X11 を使う。
//! 強制したいときは `WINIT_UNIX_BACKEND=x11 cargo run --example seven_segment_led`。

#[path = "preview_env.rs"]
mod preview_env;

use eframe::egui;
use retrocpu_emu_rs::ioboard::output::seven_segment_led::{
	hex_nibble_to_seg, paint_digit_row, SevenSegmentLed, SevenSegmentStyle, DIGIT_COUNT,
};

fn main() -> eframe::Result<()> {
	preview_env::prefer_x11_on_linux();
	let options = eframe::NativeOptions {
		viewport: egui::ViewportBuilder::default()
			.with_inner_size([720.0, 380.0])
			.with_title("IO Board 7-Segment LED"),
		..Default::default()
	};
	eframe::run_native(
		"IO Board 7-Segment LED",
		options,
		Box::new(|_cc| Ok(Box::new(PreviewApp::new()))),
	)
}

struct PreviewApp {
	led: SevenSegmentLed,
	addr: u32,
	data: u16,
	addr_digits: u8,
	data_digits: u8,
	dp_index: i32,
}

impl PreviewApp {
	/// リセットベクタ相当の ADDR とサンプル DATA で初期化する。
	fn new() -> Self {
		let mut app = Self {
			led: SevenSegmentLed::new(),
			addr: 0x0000_0108,
			data: 0xabcd,
			addr_digits: 5,
			data_digits: 4,
			dp_index: -1,
		};
		app.sync();
		app
	}

	/// スライダ値を 7セグパターンへ反映する。
	fn sync(&mut self) {
		self
			.led
			.set_addr_hex_padded(self.addr, self.addr_digits as usize);
		self
			.led
			.set_data_hex_padded(self.data, self.data_digits as usize);
		if (0..DIGIT_COUNT as i32).contains(&self.dp_index) {
			self.led.set_dp(self.dp_index as usize, true);
		}
	}
}

impl eframe::App for PreviewApp {
	fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
		egui::CentralPanel::default().show(ui, |ui| {
			ui.heading("7-Segment (ADDR 8 + DATA 4)");
			ui.add_space(8.0);
			ui.add(&self.led);
			ui.add_space(16.0);
			ui.separator();
			ui.horizontal(|ui| {
				ui.label("ADDR");
				ui.add(
					egui::DragValue::new(&mut self.addr)
						.hexadecimal(8, false, true)
						.prefix("0x"),
				);
				ui.label("digits");
				ui.add(egui::Slider::new(&mut self.addr_digits, 1..=8));
			});
			ui.horizontal(|ui| {
				ui.label("DATA");
				ui.add(
					egui::DragValue::new(&mut self.data)
						.hexadecimal(4, false, true)
						.prefix("0x"),
				);
				ui.label("digits");
				ui.add(egui::Slider::new(&mut self.data_digits, 1..=4));
			});
			ui.horizontal(|ui| {
				ui.label("DP digit (−1=off)");
				ui.add(egui::Slider::new(&mut self.dp_index, -1..=11));
			});
			self.sync();

			ui.add_space(12.0);
			ui.label("hex font 0–F (8bit, dp off)");
			let mini = SevenSegmentStyle {
				digit_width: 22.0,
				digit_height: 44.0,
				thickness: 4.5,
				digit_gap: 5.0,
				..SevenSegmentStyle::default()
			};
			let font: Vec<u8> = (0..16).map(hex_nibble_to_seg).collect();
			paint_digit_row(ui, &font, &mini);
		});
	}
}
