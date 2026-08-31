//! TMS9995 向けハンドシェイク信号ラッチ（暫定スタブ）
//! 現状は MN1613 と同じ線モデルを仮置きし、CRU 固有仕様は後続で差し替える。
//! 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc

/// IO:0020 — INTERRUPT_BUSY Bit0
pub const IO_PORT_INTERRUPT_BUSY: u16 = 0x0020;
/// IO:0021 — INT1_CAUSE Bit0 / INT2_CAUSE Bit1–2
pub const IO_PORT_INT_CAUSE: u16 = 0x0021;
/// IO:0022 — OUT_REQ / OUT_DENA / IN_DACK
pub const IO_PORT_HSHK_OUT_CTRL: u16 = 0x0022;
/// IO:0023 — HSHK_OUT_DATA（CPU→IO）
pub const IO_PORT_HSHK_OUT_DATA: u16 = 0x0023;
/// IO:0024 — IN_REQ / IN_DENA / OUT_DACK
pub const IO_PORT_HSHK_IN_CTRL: u16 = 0x0024;
/// IO:0025 — HSHK_IN_DATA（IO→CPU）
pub const IO_PORT_HSHK_IN_DATA: u16 = 0x0025;

/// IO:0022 Bit0 - CPU→IO データ要求（OUT_REQ）。
pub const HSHK_CTRL_OUT_REQ: u16 = 0x01;
/// IO:0022 Bit1 - CPU→IO データ有効（OUT_DENA）。
pub const HSHK_CTRL_OUT_DENA: u16 = 0x02;
/// IO:0022 Bit2 - IO→CPU データ受理確認（IN_DACK）。
pub const HSHK_CTRL_IN_DACK: u16 = 0x04;

/// IO:0024 Bit0 - IO→CPU データ要求（IN_REQ）。
pub const HSHK_IN_CTRL_IN_REQ: u16 = 0x01;
/// IO:0024 Bit1 - IO→CPU データ有効（IN_DENA）。
pub const HSHK_IN_CTRL_IN_DENA: u16 = 0x02;
/// IO:0024 Bit2 - CPU→IO データ受理確認（OUT_DACK）。
pub const HSHK_IN_CTRL_OUT_DACK: u16 = 0x04;

/// INT1 要因: 比較器ヒット
pub const INT1_CAUSE_ADDR_BREAK: u8 = 0;
/// INT1 要因: ステップ
pub const INT1_CAUSE_STEP: u8 = 1;
/// INT2 要因パック値: タイマー（Bit1–2 = 00）
pub const INT2_CAUSE_TIMER: u8 = 0x00;
/// INT2 要因パック値: ハンドシェイク（Bit1–2 = 01 → ポート値 0x02）
pub const INT2_CAUSE_HANDSHAKE: u8 = 0x02;

/// INT1 要因を IO:0021 Bit0 用にマスクする。
///
/// # Arguments
/// - `cause`: ADDR_BREAK / STEP
///
/// # Returns
/// - 8bit 値を返します。
pub fn encode_int1_cause(cause: u8) -> u8 {
	cause & 0x01
}

/// INT2 要因を IO:0021 Bit1–2 用にマスクする。
///
/// # Arguments
/// - `cause`: TIMER / HANDSHAKE（パック済み値）
///
/// # Returns
/// - 8bit 値を返します。
pub fn encode_int2_cause(cause: u8) -> u8 {
	cause & 0x06
}

/// CPU↔IO ハンドシェイクの線状態（1 ビットは 0/1）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HandshakeWires {
	pub interrupt_busy: u8,
	/// IO:0021 のパック値（Bit0=INT1、Bit1–2=INT2）
	pub int_cause: u8,
	pub hshk_out_req: u8,
	pub hshk_out_dena: u8,
	pub hshk_in_dack: u8,
	pub hshk_in_req: u8,
	pub hshk_in_dena: u8,
	pub hshk_out_dack: u8,
	pub hshk_out_data: u8,
	pub hshk_in_data: u8,
}

impl Default for HandshakeWires {
	fn default() -> Self {
		Self::new()
	}
}

impl HandshakeWires {
	/// 全線を 0 で初期化する。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			interrupt_busy: 0,
			int_cause: 0,
			hshk_out_req: 0,
			hshk_out_dena: 0,
			hshk_in_dack: 0,
			hshk_in_req: 0,
			hshk_in_dena: 0,
			hshk_out_dack: 0,
			hshk_out_data: 0,
			hshk_in_data: 0,
		}
	}

	/// 全線を 0 に戻す。
	pub fn reset(&mut self) {
		*self = Self::new();
	}

	/// REQ/DENA/DACK のいずれかが 1 なら転送中。
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn is_active(&self) -> bool {
		self.hshk_out_req != 0
			|| self.hshk_out_dena != 0
			|| self.hshk_in_dack != 0
			|| self.hshk_in_req != 0
			|| self.hshk_in_dena != 0
			|| self.hshk_out_dack != 0
	}

	/// IO ポート読み取り（0020–0025）。対象外は None。
	///
	/// # Arguments
	/// - `port`: ポート番号
	///
	/// # Returns
	/// - 値が存在すれば `Some(value)`、なければ `None` を返します。
	pub fn read_port(&self, port: u16) -> Option<u16> {
		match port & 0xffff {
			IO_PORT_INTERRUPT_BUSY => Some(u16::from(self.interrupt_busy & 1)),
			IO_PORT_INT_CAUSE => Some(u16::from(self.int_cause & 0x07)),
			IO_PORT_HSHK_OUT_CTRL => Some(
				(if self.hshk_out_dena != 0 {
					HSHK_CTRL_OUT_DENA
				} else {
					0
				}) | (if self.hshk_in_dack != 0 {
					HSHK_CTRL_IN_DACK
				} else {
					0
				}) | (if self.hshk_out_req != 0 {
					HSHK_CTRL_OUT_REQ
				} else {
					0
				}),
			),
			IO_PORT_HSHK_OUT_DATA => Some(u16::from(self.hshk_out_data)),
			IO_PORT_HSHK_IN_CTRL => Some(
				(if self.hshk_in_req != 0 {
					HSHK_IN_CTRL_IN_REQ
				} else {
					0
				}) | (if self.hshk_in_dena != 0 {
					HSHK_IN_CTRL_IN_DENA
				} else {
					0
				}) | (if self.hshk_out_dack != 0 {
					HSHK_IN_CTRL_OUT_DACK
				} else {
					0
				}),
			),
			IO_PORT_HSHK_IN_DATA => Some(u16::from(self.hshk_in_data)),
			_ => None,
		}
	}

	/// IO ポート書き込み（0020–0025）。対象外は false。
	///
	/// # Arguments
	/// - `port`: ポート番号
	/// - `val`: 16bit 値
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn write_port(&mut self, port: u16, val: u16) -> bool {
		let v = val & 0xffff;
		match port & 0xffff {
			IO_PORT_INTERRUPT_BUSY => {
				self.interrupt_busy = (v & 1) as u8;
				true
			}
			IO_PORT_INT_CAUSE => {
				self.int_cause = (v & 0x07) as u8;
				true
			}
			IO_PORT_HSHK_OUT_CTRL => {
				self.hshk_out_dena = u8::from((v & HSHK_CTRL_OUT_DENA) != 0);
				self.hshk_in_dack = u8::from((v & HSHK_CTRL_IN_DACK) != 0);
				self.hshk_out_req = u8::from((v & HSHK_CTRL_OUT_REQ) != 0);
				true
			}
			IO_PORT_HSHK_OUT_DATA => {
				self.hshk_out_data = (v & 0xff) as u8;
				true
			}
			IO_PORT_HSHK_IN_CTRL => {
				// 通常は IO 側入力。テスト用に書き込み可。
				self.hshk_in_req = u8::from((v & HSHK_IN_CTRL_IN_REQ) != 0);
				self.hshk_in_dena = u8::from((v & HSHK_IN_CTRL_IN_DENA) != 0);
				self.hshk_out_dack = u8::from((v & HSHK_IN_CTRL_OUT_DACK) != 0);
				true
			}
			IO_PORT_HSHK_IN_DATA => {
				self.hshk_in_data = (v & 0xff) as u8;
				true
			}
			_ => false,
		}
	}
}
