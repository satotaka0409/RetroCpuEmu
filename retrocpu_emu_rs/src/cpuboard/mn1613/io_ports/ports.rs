use crate::cpuboard::mn1613::addr_comp::{
	AddrBusAccess, AddrComparatorBank, IO_PORT_BREAK_ADDR_HI, IO_PORT_BREAK_ADDR_LO,
	IO_PORT_BREAK_CTRL, IO_PORT_BREAK_HIT, IO_PORT_BREAK_PREV,
};
use crate::cpuboard::mn1613::handshake::wires::{
	encode_int1_cause, HandshakeWires, INT1_CAUSE_ADDR_BREAK, INT1_CAUSE_STEP,
};
use crate::cpuboard::mn1613::step_run::{StepBreakUnit, IO_PORT_STEP_DELAY, IO_PORT_STEP_ENA};

use super::constants::IO_PORT_RESET_VECTOR;
use super::constants::MONITOR_ENTRY_WORD;

/// 保留中の IRQ（レベルと要因パック）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingIrq {
	/// MN1613 割り込みレベル（比較器／ステップは 1）
	pub level: u8,
	/// IO:0021 に載せる値（下位 3bit）
	pub cause: u8,
}

/// CPU ボード IO レジスタ群（比較器・ステップ・ハンドシェイク線を束ねる）
#[derive(Debug, Clone)]
pub struct IoPorts {
	reset_vector: u32,
	wires: HandshakeWires,
	comparators: AddrComparatorBank,
	step_break: StepBreakUnit,
	pending_irq: Option<PendingIrq>,
}

impl Default for IoPorts {
	fn default() -> Self {
		Self::new()
	}
}

impl IoPorts {
	/// モニター既定リセットベクタで初期化する。
	pub fn new() -> Self {
		Self {
			reset_vector: MONITOR_ENTRY_WORD,
			wires: HandshakeWires::new(),
			comparators: AddrComparatorBank::new(),
			step_break: StepBreakUnit::new(),
			pending_irq: None,
		}
	}

	/// 比較器・ステップ・線・IRQ を初期化する（リセットベクタは維持）。
	pub fn reset_peripherals(&mut self) {
		self.wires.reset();
		self.comparators.reset();
		self.step_break.reset();
		self.pending_irq = None;
	}

	/// 全状態を初期値へ戻す（リセットベクタもモニター既定）。
	pub fn reset(&mut self) {
		self.reset_vector = MONITOR_ENTRY_WORD;
		self.reset_peripherals();
	}

	/// IO:0 が返すリセットベクタ表先頭（ワードアドレス下位 16bit）。
	pub fn reset_vector(&self) -> u32 {
		self.reset_vector
	}

	/// IO ボード側が RESET_VECTOR レジスタに書く。
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		self.reset_vector = word_addr & 0xffff;
	}

	/// ハンドシェイク線への参照。
	pub fn wires(&self) -> &HandshakeWires {
		&self.wires
	}

	/// ハンドシェイク線への可変参照。
	pub fn wires_mut(&mut self) -> &mut HandshakeWires {
		&mut self.wires
	}

	/// アドレス比較器バンク。
	pub fn comparators(&self) -> &AddrComparatorBank {
		&self.comparators
	}

	/// アドレス比較器バンク（可変）。
	pub fn comparators_mut(&mut self) -> &mut AddrComparatorBank {
		&mut self.comparators
	}

	/// ステップ・ワンショット。
	pub fn step_break(&self) -> &StepBreakUnit {
		&self.step_break
	}

	/// ステップ・ワンショット（可変）。
	pub fn step_break_mut(&mut self) -> &mut StepBreakUnit {
		&mut self.step_break
	}

	/// 割り込み処理中フラグ（IO:0020 Bit0）。
	pub fn interrupt_busy(&self) -> u8 {
		self.wires.interrupt_busy & 1
	}

	/// 割り込み要因パック（IO:0021 下位 3bit）。
	pub fn int_cause(&self) -> u8 {
		self.wires.int_cause & 0x07
	}

	/// IO ボード側から割り込み要因を設定する。
	pub fn set_int_cause(&mut self, cause: u8) {
		self.wires.int_cause = cause & 0x07;
	}

	/// 保留 IRQ を取り出しクリアする。無ければ None。
	pub fn take_pending_irq(&mut self) -> Option<PendingIrq> {
		self.pending_irq.take()
	}

	/// 保留 IRQ を覗く（クリアしない）。
	pub fn peek_pending_irq(&self) -> Option<PendingIrq> {
		self.pending_irq
	}

	/// バスアクセスを比較器に渡し、ヒットなら INT1・CAUSE=0 を上げる。
	pub fn probe_addr(&mut self, access: &AddrBusAccess) -> Option<usize> {
		let hit = self.comparators.probe(access)?;
		self.raise_addr_break_irq();
		Some(hit)
	}

	/// 命令フェッチをステップユニットへ渡し、ヒットなら INT1・CAUSE=1。
	pub fn on_instruction_fetch(&mut self, word: u16) -> bool {
		if self.step_break.on_instruction_fetch(word) {
			self.raise_step_break_irq();
			true
		} else {
			false
		}
	}

	fn raise_addr_break_irq(&mut self) {
		self.set_int_cause(encode_int1_cause(INT1_CAUSE_ADDR_BREAK));
		self.pending_irq = Some(PendingIrq {
			level: 1,
			cause: encode_int1_cause(INT1_CAUSE_ADDR_BREAK),
		});
	}

	fn raise_step_break_irq(&mut self) {
		self.set_int_cause(encode_int1_cause(INT1_CAUSE_STEP));
		self.pending_irq = Some(PendingIrq {
			level: 1,
			cause: encode_int1_cause(INT1_CAUSE_STEP),
		});
	}

	/// CPU の IO リード。未マップは 0。
	pub fn read(&mut self, port: u16) -> u16 {
		let p = port & 0xffff;
		if p == IO_PORT_RESET_VECTOR {
			return (self.reset_vector & 0xffff) as u16;
		}
		if let Some(v) = self.comparators.read_port(p) {
			return v;
		}
		if let Some(v) = self.step_break.read_port(p) {
			return v;
		}
		if let Some(v) = self.wires.read_port(p) {
			return v;
		}
		0
	}

	/// CPU の IO ライト。
	pub fn write(&mut self, port: u16, val: u16) {
		let p = port & 0xffff;
		if p == IO_PORT_RESET_VECTOR {
			self.reset_vector = u32::from(val & 0xffff);
			return;
		}
		if p == IO_PORT_BREAK_CTRL
			|| p == IO_PORT_BREAK_ADDR_LO
			|| p == IO_PORT_BREAK_ADDR_HI
			|| p == IO_PORT_BREAK_HIT
			|| p == IO_PORT_BREAK_PREV
		{
			self.comparators.write_port(p, val);
			return;
		}
		if p == IO_PORT_STEP_ENA || p == IO_PORT_STEP_DELAY {
			self.step_break.write_port(p, val);
			return;
		}
		let _ = self.wires.write_port(p, val);
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::cpuboard::mn1613::addr_comp::{encode_break_ctrl, AddrComparatorSlot, BREAK_RDWR_RD};
	use crate::cpuboard::mn1613::handshake::IO_PORT_INT_CAUSE;
	use crate::cpuboard::mn1613::io_ports::{
		IO_PORT_RESET_VECTOR, RESET_VECTOR_IC_OFF, RESET_VECTOR_STR_OFF,
	};

	#[test]
	fn reset_vector_port() {
		let mut io = IoPorts::new();
		assert_eq!(io.read(IO_PORT_RESET_VECTOR), 0x0108);
		io.write(IO_PORT_RESET_VECTOR, 0x0200);
		assert_eq!(io.reset_vector(), 0x0200);
		assert_eq!(RESET_VECTOR_STR_OFF, 2);
		assert_eq!(RESET_VECTOR_IC_OFF, 3);
	}

	#[test]
	fn probe_raises_irq1_cause0() {
		let mut io = IoPorts::new();
		io.comparators_mut().set_slot(
			0,
			AddrComparatorSlot {
				enabled: true,
				io: false,
				rdwr: BREAK_RDWR_RD,
				addr: 0x50,
			},
		);
		assert_eq!(io.probe_addr(&AddrBusAccess::read(0x50, false)), Some(0));
		let irq = io.take_pending_irq().unwrap();
		assert_eq!(irq.level, 1);
		assert_eq!(irq.cause, 0);
		assert_eq!(io.read(IO_PORT_INT_CAUSE), 0);
	}

	#[test]
	fn step_raises_irq1_cause1() {
		let mut io = IoPorts::new();
		io.write(IO_PORT_STEP_DELAY, 0);
		io.write(IO_PORT_STEP_ENA, 1);
		assert!(!io.on_instruction_fetch(0x1000));
		assert!(io.on_instruction_fetch(0x1001));
		let irq = io.take_pending_irq().unwrap();
		assert_eq!(irq.level, 1);
		assert_eq!(irq.cause, 1);
	}

	#[test]
	fn break_ctrl_via_io_write() {
		let mut io = IoPorts::new();
		io.write(IO_PORT_BREAK_ADDR_LO, 0x1234);
		io.write(
			IO_PORT_BREAK_CTRL,
			encode_break_ctrl(0, true, false, BREAK_RDWR_RD),
		);
		let s = io.comparators().get_slot(0).unwrap();
		assert!(s.enabled);
		assert_eq!(s.addr, 0x1234);
	}
}
