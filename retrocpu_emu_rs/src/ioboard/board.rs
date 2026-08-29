//! IO ボード本体（設定・コンソール・キー・LED・ハンドシェイク）。
//!
//! `CpuBoardAgent` を受け取り、DMA ブートとパネル操作をまとめる。
//! 配線例はクレートルートの [`crate::board_link`] を参照。

use std::path::{Path, PathBuf};

use crate::board_link::{BoardLinkError, CpuBoardAgent, PanelHost};
use crate::ioboard::console::{ConsoleFnKey, IoConsole, IoConsoleState};
use crate::ioboard::dma::{dma_load_intel_hex, dma_load_intel_hex_file, IntelHexDmaPlan};
use crate::ioboard::handshake::{self, HandshakeDispatcher};
use crate::ioboard::input::HexKeyboard;
use crate::ioboard::output::bullet_led::BulletLed;
use crate::ioboard::output::seven_segment_led::SevenSegmentLed;
use crate::ioboard::setting_area::{
	decode_setting_area, encode_setting_area, load_settings_jsonc, IoBoardSettings,
	SETTING_AREA_SIZE,
};

/// UI／テスト用の表示スナップショット。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IoBoardSnapshot {
	/// コンソール状態。
	pub console: IoConsoleState,
	/// 7セグ 12 桁。
	pub seven_seg: [u8; 12],
	/// 砲弾 16bit。
	pub bullet_bits: u16,
	/// キー列マスク 8 バイト。
	pub key_columns: [u8; 8],
	/// HALT 表示。
	pub halted: bool,
}

/// コンソールから CPU／設定へ触るときの分割ビュー（自己借用回避）。
struct HostView<'a, A: CpuBoardAgent> {
	agent: &'a mut A,
	setting_raw: &'a mut [u8; SETTING_AREA_SIZE],
	settings: &'a mut IoBoardSettings,
	boot_ihx_path: &'a Option<PathBuf>,
}

impl<A: CpuBoardAgent> PanelHost for HostView<'_, A> {
	fn mem_read(&mut self, addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		handshake::mem_read(self.agent, addr, len)
	}

	fn mem_write(&mut self, addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		handshake::mem_write(self.agent, addr, data)
	}

	fn exec(&mut self, addr: u32) -> Result<(), BoardLinkError> {
		handshake::exec(self.agent, addr)
	}

	fn start_run(&mut self) -> Result<(), BoardLinkError> {
		self.agent.set_halt(false)
	}

	fn request_halt(&mut self) -> Result<(), BoardLinkError> {
		self.agent.set_halt(true)
	}

	fn reset_and_reload_monitor(&mut self) -> Result<(), BoardLinkError> {
		self.agent.set_halt(true)?;
		if let Some(path) = self.boot_ihx_path.clone() {
			let agent = &mut *self.agent;
			dma_load_intel_hex_file(&path, |addr, data| {
				agent
					.dma_write_bytes(addr, data)
					.map_err(|_| crate::ioboard::dma::IntelHexError {
						message: "dma write failed".into(),
					})
			})
			.map_err(|_| BoardLinkError::Ng)?;
		}
		let word = self.settings.reset_vector;
		self.agent.pulse_reset(Some(word))?;
		Ok(())
	}

	fn cpu_halted(&self) -> bool {
		self.agent.is_halted()
	}

	fn read_setting_byte(&self, byte_addr: u8) -> u8 {
		self.setting_raw[byte_addr as usize]
	}

	fn write_setting_byte(&mut self, byte_addr: u8, value: u8) {
		self.setting_raw[byte_addr as usize] = value;
		*self.settings = decode_setting_area(self.setting_raw);
	}
}

/// IO ボード（1階相当）。
pub struct IoBoard<A: CpuBoardAgent> {
	/// 解釈済み設定。
	settings: IoBoardSettings,
	/// 設定エリア生データ 256B。
	setting_raw: [u8; SETTING_AREA_SIZE],
	/// 前面コンソール。
	console: IoConsole,
	/// 16 進キー行列。
	keyboard: HexKeyboard,
	/// 7セグラッチ。
	seven_seg: SevenSegmentLed,
	/// 砲弾ラッチ。
	bullet: BulletLed,
	/// ハンドシェイクディスパッチャ。
	handshake: HandshakeDispatcher,
	/// CPU ボード Agent。
	agent: A,
	/// ブート IHX パス（RST 時に再ロード）。
	boot_ihx_path: Option<PathBuf>,
}

impl<A: CpuBoardAgent> IoBoard<A> {
	/// Agent と設定で作る（LED は初期 HALT／ADDR フォーカス）。
	///
	/// # Arguments
	/// - `agent`: 関数に渡す値
	/// - `settings`: 設定値
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new(agent: A, settings: IoBoardSettings) -> Self {
		let setting_raw = encode_setting_area(&settings);
		let mut board = Self {
			console: IoConsole::new(&settings),
			settings,
			setting_raw,
			keyboard: HexKeyboard::new(),
			seven_seg: SevenSegmentLed::new(),
			bullet: BulletLed::new(),
			handshake: HandshakeDispatcher::new(),
			agent,
			boot_ihx_path: None,
		};
		board
			.console
			.refresh_leds(&mut board.seven_seg, &mut board.bullet);
		board
	}

	/// `mn1613.jsonc` などから設定を読んで作る。
	///
	/// # Arguments
	/// - `agent`: 関数に渡す値
	/// - `path`: ファイルパス
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn from_jsonc_path(agent: A, path: impl AsRef<Path>) -> Result<Self, String> {
		let settings = load_settings_jsonc(path)?;
		Ok(Self::new(agent, settings))
	}

	/// ブート IHX の既定パスを覚える（RST で再 DMA）。
	///
	/// # Arguments
	/// - `path`: ファイルパス
	pub fn set_boot_ihx_path(&mut self, path: impl Into<PathBuf>) {
		self.boot_ihx_path = Some(path.into());
	}

	/// 設定参照。
	///
	/// # Returns
	/// - `&IoBoardSettings` を返します。
	pub fn settings(&self) -> &IoBoardSettings {
		&self.settings
	}

	/// 7セグ参照。
	///
	/// # Returns
	/// - `&SevenSegmentLed` を返します。
	pub fn seven_seg(&self) -> &SevenSegmentLed {
		&self.seven_seg
	}

	/// 砲弾参照。
	///
	/// # Returns
	/// - `&BulletLed` を返します。
	pub fn bullet(&self) -> &BulletLed {
		&self.bullet
	}

	/// キーボード参照。
	///
	/// # Returns
	/// - `&HexKeyboard` を返します。
	pub fn keyboard(&self) -> &HexKeyboard {
		&self.keyboard
	}

	/// コンソール参照。
	///
	/// # Returns
	/// - `&IoConsole` を返します。
	pub fn console(&self) -> &IoConsole {
		&self.console
	}

	/// CPU Agent への可変参照（別エージェント配線用）。
	///
	/// # Returns
	/// - `&mut A` を返します。
	pub fn agent_mut(&mut self) -> &mut A {
		&mut self.agent
	}

	/// IHX テキストを DMA で CPU RAM へ書く。
	///
	/// # Arguments
	/// - `hex_text`: 関数に渡す値
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn boot_load_ihx_text(&mut self, hex_text: &str) -> Result<IntelHexDmaPlan, BoardLinkError> {
		let agent = &mut self.agent;
		dma_load_intel_hex(hex_text, |addr, data| {
			agent
				.dma_write_bytes(addr, data)
				.map_err(|_| crate::ioboard::dma::IntelHexError {
					message: "dma write failed".into(),
				})
		})
		.map_err(|_| BoardLinkError::Ng)
	}

	/// IHX ファイルを DMA ロードする。
	///
	/// # Arguments
	/// - `path`: ファイルパス
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn boot_load_ihx(&mut self, path: impl AsRef<Path>) -> Result<IntelHexDmaPlan, BoardLinkError> {
		let path = path.as_ref();
		self.boot_ihx_path = Some(path.to_path_buf());
		let agent = &mut self.agent;
		dma_load_intel_hex_file(path, |addr, data| {
			agent
				.dma_write_bytes(addr, data)
				.map_err(|_| crate::ioboard::dma::IntelHexError {
					message: "dma write failed".into(),
				})
		})
		.map_err(|_| BoardLinkError::Ng)
	}

	/// パネルを RST 後状態にする。
	fn notify_panel_reset(&mut self) {
		let mut host = HostView {
			agent: &mut self.agent,
			setting_raw: &mut self.setting_raw,
			settings: &mut self.settings,
			boot_ihx_path: &self.boot_ihx_path,
		};
		self.console
			.notify_cpu_reset(&mut host, &mut self.seven_seg, &mut self.bullet);
	}

	/// CPU RST（ベクタは設定の reset_vector）とパネル初期化。
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn reset_cpu(&mut self) -> Result<(), BoardLinkError> {
		let word = self.settings.reset_vector;
		self.agent.pulse_reset(Some(word))?;
		self.notify_panel_reset();
		Ok(())
	}

	/// F7 相当: HALT →（任意）ブート DMA → RST → パネル初期化。
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn reset_and_reload_monitor(&mut self) -> Result<(), BoardLinkError> {
		{
			let mut host = HostView {
				agent: &mut self.agent,
				setting_raw: &mut self.setting_raw,
				settings: &mut self.settings,
				boot_ihx_path: &self.boot_ihx_path,
			};
			host.reset_and_reload_monitor()?;
		}
		self.notify_panel_reset();
		Ok(())
	}

	/// キー押下／離し（行列更新）。
	///
	/// # Arguments
	/// - `key`: 関数に渡す値
	/// - `pressed`: 押下状態フラグ
	pub fn on_key_matrix(&mut self, key: &str, pressed: bool) {
		self.keyboard.set_pressed(key, pressed);
	}

	/// 16 進ニブル入力（コンソール）。
	///
	/// # Arguments
	/// - `digit`: 関数に渡す値
	pub fn on_hex_digit(&mut self, digit: u8) {
		self.console
			.on_hex(digit, &mut self.seven_seg, &mut self.bullet);
	}

	/// ファンクションキー。
	///
	/// # Arguments
	/// - `fn_key`: 関数に渡す値
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn on_function(&mut self, fn_key: ConsoleFnKey) -> Result<(), BoardLinkError> {
		if fn_key == ConsoleFnKey::F7 {
			return self.reset_and_reload_monitor();
		}
		let mut host = HostView {
			agent: &mut self.agent,
			setting_raw: &mut self.setting_raw,
			settings: &mut self.settings,
			boot_ihx_path: &self.boot_ihx_path,
		};
		self.console
			.on_function(fn_key, &mut host, &mut self.seven_seg, &mut self.bullet)
	}

	/// キー名からコンソール操作（16 進 or F0–F7）。押下時のみアクション。
	///
	/// # Arguments
	/// - `key`: 関数に渡す値
	/// - `pressed`: 押下状態フラグ
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn on_key(&mut self, key: &str, pressed: bool) -> Result<(), BoardLinkError> {
		self.on_key_matrix(key, pressed);
		if !pressed {
			return Ok(());
		}
		let k = key.trim().to_ascii_uppercase();
		if let Some(fn_key) = ConsoleFnKey::from_name(&k) {
			return self.on_function(fn_key);
		}
		if k.len() == 1 {
			if let Some(d) = k.chars().next().and_then(|c| c.to_digit(16)) {
				self.on_hex_digit(d as u8);
			}
		}
		Ok(())
	}

	/// ハンドシェイク／CPU 状態の追い込み（MVP は HALT 表示同期）。
	pub fn tick(&mut self) {
		let halted = self.agent.is_halted();
		self.console
			.sync_cpu_halted(halted, &mut self.seven_seg, &mut self.bullet);
	}

	/// IO→CPU 生フレームをディスパッチする。
	///
	/// # Arguments
	/// - `frame`: ハンドシェイクフレーム
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn dispatch_hshk_to_cpu(&mut self, frame: &[u8]) -> Result<Vec<u8>, BoardLinkError> {
		self.handshake.dispatch_to_cpu(&mut self.agent, frame)
	}

	/// CPU→IO フレーム（スタブ応答）。
	///
	/// # Arguments
	/// - `frame`: ハンドシェイクフレーム
	///
	/// # Returns
	/// - `Vec<u8>` を返します。
	pub fn dispatch_hshk_from_cpu(&mut self, frame: &[u8]) -> Vec<u8> {
		self.handshake.dispatch_from_cpu(frame)
	}

	/// UI 用スナップショット。
	///
	/// # Returns
	/// - `IoBoardSnapshot` を返します。
	pub fn snapshot(&self) -> IoBoardSnapshot {
		let mut seven = [0u8; 12];
		seven.copy_from_slice(self.seven_seg.patterns());
		IoBoardSnapshot {
			console: self.console.state(),
			seven_seg: seven,
			bullet_bits: self.bullet.bits(),
			key_columns: self.keyboard.column_masks(),
			halted: self.agent.is_halted(),
		}
	}
}
