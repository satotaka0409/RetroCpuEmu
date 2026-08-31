use super::constants::{IO_PORT_RESET_VECTOR, MONITOR_ENTRY_WORD};

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
	reset_vector: u32,
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
			reset_vector: MONITOR_ENTRY_WORD,
			pending_irq: None,
		}
	}

	/// 周辺状態を初期化する（暫定）。
	pub fn reset_peripherals(&mut self) {
		self.pending_irq = None;
	}

	/// 全状態を初期値へ戻す。
	pub fn reset(&mut self) {
		self.reset_vector = MONITOR_ENTRY_WORD;
		self.reset_peripherals();
	}

	/// リセットベクタ（ワード）を返す。
	pub fn reset_vector(&self) -> u32 {
		self.reset_vector
	}

	/// リセットベクタ（ワード）を設定する。
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		self.reset_vector = word_addr & 0xffff;
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

	/// IO リード（未マップは 0）。
	pub fn read(&mut self, port: u16) -> u16 {
		if (port & 0xffff) == IO_PORT_RESET_VECTOR {
			(self.reset_vector & 0xffff) as u16
		} else {
			0
		}
	}

	/// IO ライト（暫定）。
	pub fn write(&mut self, port: u16, val: u16) {
		if (port & 0xffff) == IO_PORT_RESET_VECTOR {
			self.reset_vector = u32::from(val & 0xffff);
		}
	}
}
