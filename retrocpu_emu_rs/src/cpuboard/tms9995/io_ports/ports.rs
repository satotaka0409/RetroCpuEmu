use super::constants::RESET_VECTOR;

/// 保留中 IRQ（TMS9995 暫定）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingIrq {
	/// 割り込みレベルまたは識別子。
	pub level: u8,
	/// 要因コード。
	pub cause: u8,
}

/// TMS9995 用 IO レジスタ群（暫定）。
#[derive(Debug, Clone)]
pub struct IoPorts {
	reset_vector: u16,
	pending_irq: Option<PendingIrq>,
}

impl Default for IoPorts {
	fn default() -> Self {
		Self::new()
	}
}

impl IoPorts {
	/// 既定リセットベクタで初期化する。
	pub fn new() -> Self {
		Self {
			reset_vector: RESET_VECTOR,
			pending_irq: None,
		}
	}

	/// 周辺状態を初期化する（暫定）。
	pub fn reset_peripherals(&mut self) {
		self.pending_irq = None;
	}

	/// 全状態を初期値へ戻す。
	pub fn reset(&mut self) {
		self.reset_vector = RESET_VECTOR;
		self.reset_peripherals();
	}

	/// リセットベクタ（ワード）を返す。
	pub fn reset_vector(&self) -> u16 {
		self.reset_vector
	}

	/// リセットベクタ（ワード）を設定する。
	///
	/// `word_addr` は TMS9995 の 16bit ワードアドレス範囲 (`0x0000..=0xffff`) のみを受け付ける。
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		debug_assert!(
			word_addr <= 0xffff,
			"TMS9995 reset vector must fit in 16-bit word address"
		);
		self.reset_vector = (word_addr & 0xffff) as u16;
	}

	/// 保留 IRQ を取り出しクリアする。
	pub fn take_pending_irq(&mut self) -> Option<PendingIrq> {
		self.pending_irq.take()
	}

	/// 保留 IRQ を覗く（クリアしない）。
	pub fn peek_pending_irq(&self) -> Option<PendingIrq> {
		self.pending_irq
	}

	/// 命令フェッチ通知（暫定 no-op）。
	pub fn on_instruction_fetch(&mut self, _word: u16) -> bool {
		false
	}

	/// アドレス比較通知（暫定 no-op）。
	pub fn probe_addr(&mut self, _addr: u32, _is_io: bool, _is_write: bool) -> Option<usize> {
		None
	}
}

#[cfg(test)]
mod tests {
	use super::IoPorts;

	#[test]
	fn reset_vector_accepts_16bit_value() {
		let mut p = IoPorts::new();
		p.set_reset_vector(0xBEEF);
		assert_eq!(p.reset_vector(), 0xBEEF);
	}

	#[cfg(debug_assertions)]
	#[test]
	#[should_panic(expected = "TMS9995 reset vector must fit in 16-bit word address")]
	fn reset_vector_rejects_wider_than_16bit_in_debug() {
		let mut p = IoPorts::new();
		p.set_reset_vector(0x1_0000);
	}
}
