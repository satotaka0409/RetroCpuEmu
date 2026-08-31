//! TMS9995 の CRU（ビット単位 I/O）抽象と簡易バス実装。

use std::collections::BTreeMap;

/// TMS9995 の CRU ビット I/O 抽象。
pub trait Tms9995Cru {
	/// 1bit 読み取り。
	fn read_bit(&self, addr: u16) -> bool;
	/// 1bit 書き込み。
	fn write_bit(&mut self, addr: u16, value: bool);

	/// 連続 8bit を 1 バイトとして読み取る既定実装。
	fn read_data_byte(&self) -> u8 {
		let mut b = 0u8;
		for i in 0..8 {
			if self.read_bit(i) {
				b |= 1u8 << i;
			}
		}
		b
	}

	/// 1 バイトを 8 本の CRU 線へ展開して書き込む既定実装。
	fn write_data_byte(&mut self, value: u8) {
		for i in 0..8 {
			self.write_bit(i, ((value >> i) & 1) != 0);
		}
	}
}

/// テストや単体動作確認向けのメモリ上 CRU バス。
#[derive(Debug, Clone, Default)]
pub struct Tms9995CruBus {
	bits: BTreeMap<u16, bool>,
	in_data: u8,
	out_data: u8,
}

impl Tms9995CruBus {
	/// 入力側ビット線を直接設定する。
	///
	/// # Arguments
	/// - `addr`: アドレス値
	/// - `value`: 設定する値
	pub fn set_input_bit(&mut self, addr: u16, value: bool) {
		self.bits.insert(addr, value);
	}

	/// 入力側ビット線の現在値を返す。
	///
	/// # Arguments
	/// - `addr`: アドレス値
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn input_bit(&self, addr: u16) -> bool {
		self.bits.get(&addr).copied().unwrap_or(false)
	}

	/// 入力データバイト（`read_data_byte` の戻り値）を設定する。
	///
	/// # Arguments
	/// - `value`: 設定する値
	pub fn set_input_data(&mut self, value: u8) {
		self.in_data = value;
	}

	/// 出力データバイト（`write_data_byte` の最終値）を読む。
	///
	/// # Returns
	/// - 8bit 値を返します。
	pub fn output_data(&self) -> u8 {
		self.out_data
	}
}

impl Tms9995Cru for Tms9995CruBus {
	fn read_bit(&self, addr: u16) -> bool {
		self.bits.get(&addr).copied().unwrap_or(false)
	}

	fn write_bit(&mut self, addr: u16, value: bool) {
		self.bits.insert(addr, value);
	}

	fn read_data_byte(&self) -> u8 {
		self.in_data
	}

	fn write_data_byte(&mut self, value: u8) {
		self.out_data = value;
	}
}
