//! MN1613 最小エミュ（コア＋IO ポート＋CPU BoardAgent）。
//!
//! 単一プロセスで 2 論理ボードを束ねる。後で thread + channel に切れる境界は
//! [`crate::board_link::CpuBoardAgent`] / [`crate::ioboard::IoBoard`]。

use std::cell::RefCell;
use std::rc::Rc;

use crate::board_link::{BoardLinkError, CpuBoardAgent};
use crate::cpuboard::{
	Mn1613AddrBusAccess, Mn1613Core, Mn1613CpuRegisterPatch, Mn1613ExecStatus, Mn1613IoCallbacks,
	Mn1613IoPorts, Mn1613MemAccessEvent, Mn1613Ram, Tms9995Bus, Tms9995Core, Tms9995CruBus,
	Tms9995IoPorts, Tms9995Ram, Tms9995StepResult, MN1613_MONITOR_ENTRY_WORD, PHYS_MASK,
};

/// `IoPorts` をコアの IO コールバックへ橋渡しする。
struct IoPortsCb {
	ports: Rc<RefCell<Mn1613IoPorts>>,
}

impl Mn1613IoCallbacks for IoPortsCb {
	fn io_read(&mut self, port: u16) -> u16 {
		self.ports.borrow_mut().read(port)
	}

	fn io_write(&mut self, port: u16, val: u16) {
		self.ports.borrow_mut().write(port, val);
	}
}

/// MN1613 CPU 側エージェント（パネル／ハンドシェイクの相手）。
pub struct Mn1613CpuAgent {
	/// CPU コア。
	pub core: Mn1613Core,
	/// 物理 RAM（256K ワード）。
	pub ram: Mn1613Ram,
	/// IO マップ（比較器・ステップ・RESET_VECTOR）。
	ports: Rc<RefCell<Mn1613IoPorts>>,
	/// 外部 HALT 要求（パネル H/ST）。コア Halted と OR。
	ext_halt: bool,
}

impl Default for Mn1613CpuAgent {
	fn default() -> Self {
		Self::new()
	}
}

impl Mn1613CpuAgent {
	/// 空 RAM・既定 IO・電源投入 idle で作る。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		let ports = Rc::new(RefCell::new(Mn1613IoPorts::new()));
		let mut core = Mn1613Core::new();
		core.set_io_callbacks(Box::new(IoPortsCb {
			ports: Rc::clone(&ports),
		}));
		let ports_hook = Rc::clone(&ports);
		core.set_mem_hook(Some(Box::new(move |ev: Mn1613MemAccessEvent| {
			let mut p = ports_hook.borrow_mut();
			if ev.fetch {
				let _ = p.on_instruction_fetch(ev.data);
			}
			let access = Mn1613AddrBusAccess {
				addr: ev.phys & PHYS_MASK,
				io: false,
				write: ev.write,
				data: Some(ev.data),
				prev: Some(ev.prev),
			};
			let _ = p.probe_addr(&access);
		})));
		core.power_on_idle();
		Self {
			core,
			ram: Mn1613Ram::new(true),
			ports,
			ext_halt: true,
		}
	}

	/// IO ポート参照。
	///
	/// # Returns
	/// - I/O ポート共有参照を返します。
	pub fn ports(&self) -> &Rc<RefCell<Mn1613IoPorts>> {
		&self.ports
	}

	/// リセットベクタ（ワード）を設定する。
	///
	/// # Arguments
	/// - `word_addr`: ワードアドレス
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		self.ports.borrow_mut().set_reset_vector(word_addr);
	}

	/// 最大 `max_inst` 命令まで進める（外部 HALT 中は 0）。
	///
	/// 比較器／ステップで上がった IRQ は **命令ごと** にコアへ渡す（1 バッチ内遅延を防ぐ）。
	///
	/// * `max_inst` — 実行上限（0=上限なし）
	///
	/// # Arguments
	/// - `max_inst`: 実行する最大命令数（0 で無制限）
	///
	/// # Returns
	/// - 現在の実行状態を返します。
	pub fn run_slice(&mut self, max_inst: u32) -> Mn1613ExecStatus {
		if self.ext_halt {
			return Mn1613ExecStatus::Halted;
		}
		let limit = if max_inst == 0 { u32::MAX } else { max_inst };
		for _ in 0..limit {
			if let Some(irq) = self.ports.borrow_mut().take_pending_irq() {
				self.core.trigger_interrupt(irq.level);
			}
			if self.core.get_exec_status() == Mn1613ExecStatus::Idle {
				self.core.set_exec_status(Mn1613ExecStatus::Running);
			}
			self.core.tick(&mut self.ram);
			let st = self.core.get_exec_status();
			if matches!(
				st,
				Mn1613ExecStatus::Halted | Mn1613ExecStatus::Break | Mn1613ExecStatus::Step
			) {
				return st;
			}
			if self.ext_halt {
				self.core.halt();
				return Mn1613ExecStatus::Halted;
			}
		}
		self.core.get_exec_status()
	}

	/// HALT するまで（または上限まで）回す。
	///
	/// * `max_inst` — 安全上限
	///
	/// # Arguments
	/// - `max_inst`: 実行する最大命令数（0 で無制限）
	///
	/// # Returns
	/// - 現在の実行状態を返します。
	pub fn run_until_halt(&mut self, max_inst: u32) -> Mn1613ExecStatus {
		self.ext_halt = false;
		if self.core.get_exec_status() == Mn1613ExecStatus::Idle
			|| self.core.get_exec_status() == Mn1613ExecStatus::Halted
		{
			// リセット直後は Running。idle なら kick。
			if self.core.get_exec_status() == Mn1613ExecStatus::Idle {
				self.core.set_exec_status(Mn1613ExecStatus::Running);
			}
		}
		let mut left = max_inst;
		while left > 0 {
			let before = left.min(4096);
			let st = self.run_slice(before);
			left = left.saturating_sub(before);
			if matches!(
				st,
				Mn1613ExecStatus::Halted | Mn1613ExecStatus::Break | Mn1613ExecStatus::Step
			) {
				return st;
			}
			if self.ext_halt {
				self.core.halt();
				return Mn1613ExecStatus::Halted;
			}
		}
		self.core.get_exec_status()
	}

	/// 物理ワードを読む（テスト用）。
	///
	/// # Arguments
	/// - `word_addr`: ワードアドレス
	///
	/// # Returns
	/// - 16bit 値を返します。
	pub fn read_word(&self, word_addr: u32) -> u16 {
		self.ram.read_phys(word_addr & PHYS_MASK)
	}

	/// バイト列を BE で読む（ハンドシェイク `83h`）。
	fn read_bytes(&self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		let mut out = Vec::with_capacity(len as usize);
		let mut ba = byte_addr;
		for _ in 0..len {
			let w = self.ram.read_phys((ba / 2) & PHYS_MASK);
			let b = if ba % 2 == 0 {
				((w >> 8) & 0xff) as u8
			} else {
				(w & 0xff) as u8
			};
			out.push(b);
			ba = ba.wrapping_add(1);
		}
		Ok(out)
	}
}

impl CpuBoardAgent for Mn1613CpuAgent {
	fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.ram.dma_write_bytes(byte_addr, data);
		Ok(())
	}

	fn hshk_mem_read(&mut self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		self.read_bytes(byte_addr, len)
	}

	fn hshk_mem_write(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.ram.dma_write_bytes(byte_addr, data);
		Ok(())
	}

	fn hshk_exec(&mut self, byte_addr: u32) -> Result<(), BoardLinkError> {
		if byte_addr % 2 != 0 {
			return Err(BoardLinkError::BadFrame);
		}
		let word = (byte_addr / 2) as u16;
		self.ext_halt = false;
		self.core.set_state(&Mn1613CpuRegisterPatch {
			ic: Some(word),
			..Default::default()
		});
		self.core.set_exec_status(Mn1613ExecStatus::Running);
		Ok(())
	}

	fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError> {
		self.ext_halt = halt;
		if halt {
			self.core.halt();
		} else if self.core.get_exec_status() == Mn1613ExecStatus::Halted {
			self.core.set_exec_status(Mn1613ExecStatus::Running);
		}
		Ok(())
	}

	fn pulse_reset(&mut self, reset_vector_word: Option<u32>) -> Result<(), BoardLinkError> {
		if let Some(v) = reset_vector_word {
			self.set_reset_vector(v);
		} else {
			self.set_reset_vector(MN1613_MONITOR_ENTRY_WORD);
		}
		self.ports.borrow_mut().reset_peripherals();
		self.ext_halt = false;
		self.core.reset(&self.ram);
		Ok(())
	}

	fn is_halted(&self) -> bool {
		self.ext_halt || self.core.get_exec_status() == Mn1613ExecStatus::Halted
	}
}

/// TMS9995 CPU 側エージェント（最小実装）。
pub struct Tms9995CpuAgent {
	/// CPU コア。
	pub core: Tms9995Core,
	/// 物理 RAM（64KB）。
	pub ram: Tms9995Ram,
	/// CRU バス。
	pub cru: Tms9995CruBus,
	/// IO マップ（リセットベクタ保持）。
	ports: Rc<RefCell<Tms9995IoPorts>>,
	/// 外部 HALT 要求。
	ext_halt: bool,
}

impl Default for Tms9995CpuAgent {
	fn default() -> Self {
		Self::new()
	}
}

impl Tms9995CpuAgent {
	/// 空 RAM・既定 IO で作る。
	pub fn new() -> Self {
		let mut this = Self {
			core: Tms9995Core::new(),
			ram: Tms9995Ram::new(0x1_0000, true),
			cru: Tms9995CruBus::default(),
			ports: Rc::new(RefCell::new(Tms9995IoPorts::new())),
			ext_halt: true,
		};
		this.apply_reset_vector_to_ram();
		this.core.reset_from_vector(&this.ram);
		this
	}

	/// リセットベクタ（ワード）を設定する。
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		debug_assert!(
			word_addr <= 0xffff,
			"TMS9995 reset vector must fit in 16-bit word address"
		);
		self.ports.borrow_mut().set_reset_vector(word_addr);
		self.apply_reset_vector_to_ram();
	}

	/// 実行スライス（最大 `max_inst` 命令）。
	pub fn run_slice(&mut self, max_inst: u32) -> Tms9995StepResult {
		if self.ext_halt {
			return Tms9995StepResult::Idle;
		}
		for _ in 0..max_inst {
			if self.ports.borrow_mut().take_pending_irq().is_some() {
				// IRQ 配線は後続。現状は保留を捨てる。
			}
			let Ok(st) = self.core.step(&mut self.ram, &mut self.cru) else {
				let mut s = self.core.state();
				s.idle = true;
				self.core.set_state(s);
				return Tms9995StepResult::Idle;
			};
			if st == Tms9995StepResult::Idle {
				return Tms9995StepResult::Idle;
			}
			if self.ext_halt {
				let mut s = self.core.state();
				s.idle = true;
				self.core.set_state(s);
				return Tms9995StepResult::Idle;
			}
		}
		Tms9995StepResult::Running
	}

	/// HALT まで（または上限まで）回す。
	pub fn run_until_halt(&mut self, max_inst: u32) -> Tms9995StepResult {
		self.ext_halt = false;
		let mut left = max_inst;
		while left > 0 {
			let chunk = left.min(4096);
			let st = self.run_slice(chunk);
			left = left.saturating_sub(chunk);
			if st == Tms9995StepResult::Idle {
				return Tms9995StepResult::Idle;
			}
		}
		Tms9995StepResult::Running
	}

	fn read_bytes(&self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		let end = byte_addr.checked_add(len).ok_or(BoardLinkError::BadFrame)?;
		if end > self.ram.len_bytes() as u32 {
			return Err(BoardLinkError::Ng);
		}
		let mut out = Vec::with_capacity(len as usize);
		for off in 0..len {
			out.push(self.ram.read_byte((byte_addr + off) as u16));
		}
		Ok(out)
	}

	fn write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		let end = byte_addr
			.checked_add(data.len() as u32)
			.ok_or(BoardLinkError::BadFrame)?;
		if end > self.ram.len_bytes() as u32 {
			return Err(BoardLinkError::Ng);
		}
		for (i, &b) in data.iter().enumerate() {
			self.ram.write_byte((byte_addr + i as u32) as u16, b);
		}
		Ok(())
	}

	fn apply_reset_vector_to_ram(&mut self) {
		let pc_byte = ((self.ports.borrow().reset_vector() & 0xffff) as u16).wrapping_mul(2) & 0xfffe;
		self.ram.write_word(0x0002, pc_byte);
	}
}

impl CpuBoardAgent for Tms9995CpuAgent {
	fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		if !self.is_halted() {
			return Err(BoardLinkError::Ng);
		}
		self.write_bytes(byte_addr, data)
	}

	fn hshk_mem_read(&mut self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		self.read_bytes(byte_addr, len)
	}

	fn hshk_mem_write(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.write_bytes(byte_addr, data)
	}

	fn hshk_exec(&mut self, byte_addr: u32) -> Result<(), BoardLinkError> {
		if byte_addr > 0xffff {
			return Err(BoardLinkError::BadFrame);
		}
		if (byte_addr & 1) != 0 {
			return Err(BoardLinkError::BadFrame);
		}
		let mut st = self.core.state();
		st.pc = (byte_addr as u16) & 0xfffe;
		st.idle = false;
		self.core.set_state(st);
		self.ext_halt = false;
		Ok(())
	}

	fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError> {
		self.ext_halt = halt;
		if halt {
			let mut st = self.core.state();
			st.idle = true;
			self.core.set_state(st);
		}
		Ok(())
	}

	fn pulse_reset(&mut self, reset_vector_word: Option<u32>) -> Result<(), BoardLinkError> {
		if let Some(v) = reset_vector_word {
			if v > 0xffff {
				return Err(BoardLinkError::BadFrame);
			}
			self.set_reset_vector(v);
		}
		self.ports.borrow_mut().reset_peripherals();
		self.ext_halt = false;
		self.core.reset_from_vector(&self.ram);
		Ok(())
	}

	fn is_halted(&self) -> bool {
		self.ext_halt || self.core.state().idle
	}
}

#[cfg(test)]
mod tests {
	use super::{Mn1613CpuAgent, Mn1613ExecStatus, Tms9995CpuAgent};
	use crate::board_link::{BoardLinkError, CpuBoardAgent};

	#[test]
	fn tms9995_exec_rejects_out_of_16bit_byte_address() {
		let mut agent = Tms9995CpuAgent::new();
		let err = CpuBoardAgent::hshk_exec(&mut agent, 0x1_0000).unwrap_err();
		assert_eq!(err, BoardLinkError::BadFrame);
	}

	#[test]
	fn tms9995_reset_rejects_out_of_16bit_word_address() {
		let mut agent = Tms9995CpuAgent::new();
		let err = CpuBoardAgent::pulse_reset(&mut agent, Some(0x1_0000)).unwrap_err();
		assert_eq!(err, BoardLinkError::BadFrame);
	}

	/// 比較器ヒット IRQ が `run_slice` ループ先頭でコアへ渡る。
	#[test]
	fn mn1613_comparator_irq_delivered_per_instruction() {
		use crate::cpuboard::mn1613::addr_comp::{AddrBusAccess, AddrComparatorSlot, BREAK_RDWR_RD};

		let mut agent = Mn1613CpuAgent::new();
		let _ = agent.set_halt(false);
		agent.core.set_exec_status(Mn1613ExecStatus::Running);
		{
			let mut ports = agent.ports.borrow_mut();
			ports.comparators_mut().set_slot(
				0,
				AddrComparatorSlot {
					enabled: true,
					io: false,
					rdwr: BREAK_RDWR_RD,
					addr: 1,
				},
			);
			ports.probe_addr(&AddrBusAccess::read(1, false));
			assert!(ports.peek_pending_irq().is_some());
		}
		let _ = agent.run_slice(1);
		assert!(
			agent.ports.borrow().peek_pending_irq().is_none(),
			"run_slice must consume pending comparator IRQ before ticking"
		);
		assert_eq!(
			agent.core.get_pending_irq() & 0x02,
			0x02,
			"level-1 IRQ should be forwarded to the core"
		);
	}
}
