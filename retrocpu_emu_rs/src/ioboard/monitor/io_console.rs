//! IO ボード前面パネル（ioboard.mdc ファンクションキー）。
//!
//! メモリ R/W はハンドシェイク `83h`/`84h`、実行は `82h`。
//! 表示はパネル自身が 7セグ／砲弾を駆動（モニタは `16h` を使わない）。

use crate::board_link::{BoardLinkError, PanelHost};
use crate::ioboard::input::{apply_hex_digit_to_addr, apply_hex_digit_to_data};
use crate::ioboard::monitor::IoMonitor;
use crate::ioboard::output::bullet_led::{
	BulletLed, LED_ADDR, LED_DATA, LED_HALT, LED_RUN, LED_UNDEF,
};
use crate::ioboard::output::seven_segment_led::{
	word_to_seg_digits, word_to_seg_digits_padded, SevenSegmentLed, ADDR_DIGIT_COUNT,
	DATA_DIGIT_COUNT, DIGIT_COUNT, SEG_DASH,
};
use crate::ioboard::setting_area::{
	default_settings_for_cpu, normalize_addr_step, offsets, IoBoardSettings,
};

/// ADDR / DATA 入力フォーカス。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsoleFocus {
	/// アドレス部。
	Addr,
	/// データ部。
	Data,
}

/// モニター／設定エリア編集。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsoleMode {
	/// 通常モニター。
	Monitor,
	/// ADS 長押しの設定エリア。
	SettingArea,
}

/// ファンクションキー F0–F7。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsoleFnKey {
	/// ADS。
	F0,
	/// CLR。
	F1,
	/// INC。
	F2,
	/// DEC。
	F3,
	/// WINC。
	F4,
	/// RUN。
	F5,
	/// H/ST。
	F6,
	/// RST。
	F7,
}

impl ConsoleFnKey {
	/// `"F0"`–`"F7"` から変換。
	///
	/// # Arguments
	/// - `name`: 関数に渡す値
	///
	/// # Returns
	/// - `Option<Self>` を返します。
	pub fn from_name(name: &str) -> Option<Self> {
		match name.trim().to_ascii_uppercase().as_str() {
			"F0" => Some(Self::F0),
			"F1" => Some(Self::F1),
			"F2" => Some(Self::F2),
			"F3" => Some(Self::F3),
			"F4" => Some(Self::F4),
			"F5" => Some(Self::F5),
			"F6" => Some(Self::F6),
			"F7" => Some(Self::F7),
			_ => None,
		}
	}

	/// 表示ラベル。
	///
	/// # Returns
	/// - `&'static str` を返します。
	pub fn label(self) -> &'static str {
		match self {
			Self::F0 => "ADS",
			Self::F1 => "CLR",
			Self::F2 => "INC",
			Self::F3 => "DEC",
			Self::F4 => "WINC",
			Self::F5 => "RUN",
			Self::F6 => "H/ST",
			Self::F7 => "RST",
		}
	}
}

/// パネル状態スナップショット。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IoConsoleState {
	/// ワードアドレス（ADDR 表示）。
	pub word_addr: u32,
	/// データワード（DATA 表示）。
	pub data_word: u16,
	/// 入力フォーカス。
	pub focus: ConsoleFocus,
	/// モード。
	pub mode: ConsoleMode,
	/// HALT 表示。
	pub halted: bool,
	/// UNDEF（砲弾 B）。
	pub undef_insn: bool,
}

/// IO ボード前面コンソール。
#[derive(Debug, Clone)]
pub struct IoConsole {
	word_addr: u32,
	data_word: u16,
	focus: ConsoleFocus,
	mode: ConsoleMode,
	halted: bool,
	undef_insn: bool,
	addr_step: u8,
	addr_digits: u8,
	data_digits: u8,
}

impl Default for IoConsole {
	fn default() -> Self {
		Self::new(&IoBoardSettings::default())
	}
}

impl IoConsole {
	/// 設定から桁数・増加数を初期化する。
	///
	/// # Arguments
	/// - `settings`: 設定値
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new(settings: &IoBoardSettings) -> Self {
		Self {
			word_addr: 0,
			data_word: 0,
			focus: ConsoleFocus::Addr,
			mode: ConsoleMode::Monitor,
			halted: true,
			undef_insn: false,
			addr_step: normalize_addr_step(settings.addr_step),
			addr_digits: settings.seven_seg_addr_digits.clamp(1, 8),
			data_digits: settings.seven_seg_data_digits.clamp(1, 4),
		}
	}

	/// 現在状態。
	///
	/// # Returns
	/// - `IoConsoleState` を返します。
	pub fn state(&self) -> IoConsoleState {
		IoConsoleState {
			word_addr: self.word_addr,
			data_word: self.data_word,
			focus: self.focus,
			mode: self.mode,
			halted: self.halted,
			undef_insn: self.undef_insn,
		}
	}

	/// RST 後のパネル表示（ADDR 入力・値 0・UNDEF 消灯・HALT）。
	pub fn notify_cpu_reset<H: PanelHost>(
		&mut self,
		host: &mut H,
		seven: &mut SevenSegmentLed,
		bullet: &mut BulletLed,
	) {
		self.sync_from_settings(host);
		self.word_addr = 0;
		self.data_word = 0;
		self.focus = ConsoleFocus::Addr;
		self.mode = ConsoleMode::Monitor;
		self.undef_insn = false;
		self.halted = true;
		self.refresh_leds(seven, bullet);
	}

	/// ADS 長押しで設定エリア編集モードへ入退する。
	pub fn on_ads_long_press<H: PanelHost>(
		&mut self,
		host: &mut H,
		seven: &mut SevenSegmentLed,
		bullet: &mut BulletLed,
	) {
		let leaving = self.mode == ConsoleMode::SettingArea;
		self.mode = if self.mode == ConsoleMode::Monitor {
			ConsoleMode::SettingArea
		} else {
			ConsoleMode::Monitor
		};
		self.focus = ConsoleFocus::Addr;
		self.word_addr = 0;
		self.data_word = 0;
		if leaving {
			self.sync_from_settings(host);
		}
		self.refresh_leds(seven, bullet);
	}

	/// CPU 実行状態を砲弾 C/D に反映する。
	pub fn sync_cpu_halted(
		&mut self,
		halted: bool,
		seven: &mut SevenSegmentLed,
		bullet: &mut BulletLed,
	) {
		if self.halted == halted {
			return;
		}
		self.halted = halted;
		self.refresh_leds(seven, bullet);
	}

	/// ハンドシェイク `13h` 相当の UNDEF LED。
	pub fn set_undef_led(&mut self, on: bool, seven: &mut SevenSegmentLed, bullet: &mut BulletLed) {
		self.undef_insn = on;
		if on {
			self.halted = true;
		}
		self.refresh_leds(seven, bullet);
	}

	/// 16 進キー 0–F（1 ニブル）。
	pub fn on_hex(&mut self, digit: u8, seven: &mut SevenSegmentLed, bullet: &mut BulletLed) {
		match self.focus {
			ConsoleFocus::Addr => {
				self.word_addr =
					apply_hex_digit_to_addr(self.word_addr, digit, self.mode == ConsoleMode::SettingArea);
			}
			ConsoleFocus::Data => {
				self.data_word =
					apply_hex_digit_to_data(self.data_word, digit, self.mode == ConsoleMode::SettingArea);
			}
		}
		self.refresh_leds(seven, bullet);
	}

	/// ファンクションキー処理。
	pub fn on_function<H: PanelHost>(
		&mut self,
		fn_key: ConsoleFnKey,
		host: &mut H,
		seven: &mut SevenSegmentLed,
		bullet: &mut BulletLed,
	) -> Result<(), BoardLinkError> {
		self.sync_from_settings(host);
		match fn_key {
			ConsoleFnKey::F0 => {
				self.focus = match self.focus {
					ConsoleFocus::Addr => ConsoleFocus::Data,
					ConsoleFocus::Data => ConsoleFocus::Addr,
				};
				if self.focus == ConsoleFocus::Data {
					self.align_monitor_addr();
					self.read_at(host, self.word_addr)?;
				}
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F1 => {
				if self.focus == ConsoleFocus::Addr {
					self.word_addr = 0;
				} else {
					self.data_word = 0;
				}
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F2 => {
				self.align_monitor_addr();
				self.word_addr = self.add_addr(self.addr_delta() as i32);
				self.read_at(host, self.word_addr)?;
				self.focus = ConsoleFocus::Data;
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F3 => {
				self.align_monitor_addr();
				self.word_addr = self.add_addr(-(self.addr_delta() as i32));
				self.read_at(host, self.word_addr)?;
				self.focus = ConsoleFocus::Data;
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F4 => {
				self.align_monitor_addr();
				IoMonitor::write_word(
					host,
					self.word_addr,
					self.data_word,
					self.mode == ConsoleMode::SettingArea,
				)?;
				self.word_addr = self.add_addr(self.addr_delta() as i32);
				self.read_at(host, self.word_addr)?;
				self.focus = ConsoleFocus::Data;
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F5 => {
				self.align_monitor_addr();
				IoMonitor::exec_word(host, self.word_addr)?;
				self.halted = false;
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F6 => {
				if self.halted {
					host.start_run()?;
					self.halted = false;
				} else {
					host.request_halt()?;
					self.halted = true;
				}
				self.refresh_leds(seven, bullet);
			}
			ConsoleFnKey::F7 => {
				host.reset_and_reload_monitor()?;
				self.notify_cpu_reset(host, seven, bullet);
			}
		}
		Ok(())
	}

	/// 設定から増加数・桁数を取り込む。
	///
	/// # Arguments
	/// - `host`: 関数に渡す値
	pub fn sync_from_settings<H: PanelHost>(&mut self, host: &H) {
		let cpu = host.read_setting_byte(offsets::CPU_TYPE as u8);
		let defaults = default_settings_for_cpu(cpu);
		self.addr_step = normalize_addr_step(host.read_setting_byte(offsets::ADDR_STEP as u8));
		let ad = host.read_setting_byte(offsets::SEVEN_SEG_ADDR_DIGITS as u8);
		let dd = host.read_setting_byte(offsets::SEVEN_SEG_DATA_DIGITS as u8);
		self.addr_digits = if (1..=8).contains(&ad) {
			ad
		} else {
			defaults.seven_seg_addr_digits
		};
		self.data_digits = if (1..=4).contains(&dd) {
			dd
		} else {
			defaults.seven_seg_data_digits
		};
	}

	fn align_monitor_addr(&mut self) {
		if self.mode != ConsoleMode::Monitor {
			return;
		}
		self.word_addr = IoMonitor::align_word_addr(self.word_addr, self.addr_step);
	}

	fn addr_delta(&self) -> u8 {
		IoMonitor::addr_delta(self.mode == ConsoleMode::SettingArea, self.addr_step)
	}

	fn add_addr(&self, delta: i32) -> u32 {
		IoMonitor::shift_word_addr(self.word_addr, delta, self.mode == ConsoleMode::SettingArea)
	}

	fn read_at<H: PanelHost>(&mut self, host: &mut H, word_addr: u32) -> Result<(), BoardLinkError> {
		self.data_word = IoMonitor::read_word(host, word_addr, self.mode == ConsoleMode::SettingArea)?;
		Ok(())
	}

	/// ADDR/DATA + ADS(E/F) + HALT(D)/RUN(C) + UNDEF(B) を LED に載せる。
	///
	/// # Arguments
	/// - `seven`: 関数に渡す値
	/// - `bullet`: 関数に渡す値
	pub fn refresh_leds(&self, seven: &mut SevenSegmentLed, bullet: &mut BulletLed) {
		let mut patterns = [0u8; DIGIT_COUNT];
		if self.mode == ConsoleMode::SettingArea {
			let addr = word_to_seg_digits(self.word_addr & 0xff, 2);
			patterns[0] = SEG_DASH;
			patterns[6] = addr[0];
			patterns[7] = addr[1];
			let data = word_to_seg_digits(u32::from(self.data_word & 0xff), 2);
			patterns[10] = data[0];
			patterns[11] = data[1];
		} else {
			let addr =
				word_to_seg_digits_padded(self.word_addr, self.addr_digits as usize, ADDR_DIGIT_COUNT);
			let data = word_to_seg_digits_padded(
				u32::from(self.data_word),
				self.data_digits as usize,
				DATA_DIGIT_COUNT,
			);
			patterns[..ADDR_DIGIT_COUNT].copy_from_slice(&addr);
			patterns[ADDR_DIGIT_COUNT..].copy_from_slice(&data);
		}
		seven.set_patterns(&patterns);

		let mut bits: u16 = 0;
		match self.focus {
			ConsoleFocus::Addr => bits |= 1 << LED_ADDR,
			ConsoleFocus::Data => bits |= 1 << LED_DATA,
		}
		if self.halted {
			bits |= 1 << LED_HALT;
		} else {
			bits |= 1 << LED_RUN;
		}
		if self.undef_insn {
			bits |= 1 << LED_UNDEF;
		}
		// 砲弾 0–A は触らない（ユーザー／16h 用）。B–F だけ差し替え。
		let lo = bullet.bits() & 0x07ff;
		bullet.set_bits(lo | (bits & 0xf800));
	}
}
