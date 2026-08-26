//! 砲弾 LED 16 本の表示確認用ウィンドウ。
//!
//! ```text
//! cargo run --example bullet_led
//! ```
//!
//! WSL で Wayland が壊れている場合は自動で X11 を使う。
//! 強制したいときは `WINIT_UNIX_BACKEND=x11 cargo run --example bullet_led`。

#[path = "preview_env.rs"]
mod preview_env;

use eframe::egui;
use retrocpu_emu_rs::ioboard::output::bullet_led::{
	BulletLed, BULLET_COUNT, LED_ADDR, LED_DATA, LED_HALT, LED_RUN, LED_UNDEF,
};

fn main() -> eframe::Result<()> {
	preview_env::prefer_x11_on_linux();
	let options = eframe::NativeOptions {
		viewport: egui::ViewportBuilder::default()
			.with_inner_size([720.0, 280.0])
			.with_title("IO Board Bullet LED"),
		..Default::default()
	};
	eframe::run_native(
		"IO Board Bullet LED",
		options,
		Box::new(|_cc| Ok(Box::new(PreviewApp::new()))),
	)
}

struct PreviewApp {
	led: BulletLed,
}

impl PreviewApp {
	/// RUN 点灯・ADDR 選択の初期状態で始める。
	fn new() -> Self {
		let mut led = BulletLed::new();
		led.set(LED_RUN, true);
		led.set(LED_ADDR, true);
		led.set(0, true);
		led.set(0xA, true);
		Self { led }
	}
}

impl eframe::App for PreviewApp {
	fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
		egui::CentralPanel::default().show(ui, |ui| {
			ui.heading("Bullet LEDs (0–F)");
			ui.add_space(8.0);
			ui.add(&self.led);
			ui.add_space(16.0);
			ui.separator();
			ui.label("toggle bits (16h lo=0–7, hi=8–F)");
			ui.horizontal_wrapped(|ui| {
				for i in 0..BULLET_COUNT {
					let mut on = self.led.is_on(i);
					let name = match i {
						LED_UNDEF => "B UNDEF".to_string(),
						LED_RUN => "C RUN".to_string(),
						LED_HALT => "D HALT".to_string(),
						LED_ADDR => "E ADDR".to_string(),
						LED_DATA => "F DATA".to_string(),
						_ => format!("{i:X}"),
					};
					if ui.checkbox(&mut on, name).changed() {
						self.led.set(i, on);
					}
				}
			});
			let (lo, hi) = self.led.bytes();
			ui.monospace(format!("bulletLed0_7={lo:02X}  bulletLed8_F={hi:02X}"));
		});
	}
}
