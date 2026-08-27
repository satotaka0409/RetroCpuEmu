//! MN1613 最小エミュ（コア＋IO ポート＋CPU BoardAgent）。
//!
//! 単一プロセスで 2 論理ボードを束ねる。後で thread + channel に切れる境界は
//! [`crate::board_link::CpuBoardAgent`] / [`crate::ioboard::IoBoard`]。

use std::cell::RefCell;
use std::rc::Rc;

use crate::board_link::{BoardLinkError, CpuBoardAgent};
use crate::cpuboard::cpu_core::mn1613::{
	ExecStatus, IoCallbacks, MemAccessEvent, Mn1613Core, Mn1613Ram, PHYS_MASK,
};
use crate::cpuboard::io_ports::{IoPorts, MONITOR_ENTRY_WORD};
use crate::cpuboard::mn1613::AddrBusAccess;

/// `IoPorts` をコアの IO コールバックへ橋渡しする。
struct IoPortsCb {
	ports: Rc<RefCell<IoPorts>>,
}

impl IoCallbacks for IoPortsCb {
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
	ports: Rc<RefCell<IoPorts>>,
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
	pub fn new() -> Self {
		let ports = Rc::new(RefCell::new(IoPorts::new()));
		let mut core = Mn1613Core::new();
		core.set_io_callbacks(Box::new(IoPortsCb {
			ports: Rc::clone(&ports),
		}));
		let ports_hook = Rc::clone(&ports);
		core.set_mem_hook(Some(Box::new(move |ev: MemAccessEvent| {
			let mut p = ports_hook.borrow_mut();
			if ev.fetch {
				let _ = p.on_instruction_fetch(ev.data);
			}
			let access = AddrBusAccess {
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
			ram: Mn1613Ram::new(),
			ports,
			ext_halt: true,
		}
	}

	/// IO ポート参照。
	pub fn ports(&self) -> &Rc<RefCell<IoPorts>> {
		&self.ports
	}

	/// リセットベクタ（ワード）を設定する。
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		self.ports.borrow_mut().set_reset_vector(word_addr);
	}

	/// 最大 `max_inst` 命令まで進める（外部 HALT 中は 0）。
	///
	/// * `max_inst` — 実行上限（0=何もしない）
	pub fn run_slice(&mut self, max_inst: u32) -> ExecStatus {
		if self.ext_halt {
			return ExecStatus::Halted;
		}
		// 比較器／ステップ IRQ をコアへ配送
		if let Some(irq) = self.ports.borrow_mut().take_pending_irq() {
			self.core.trigger_interrupt(irq.level);
		}
		self.core
			.run_slice(&mut self.ram, None, max_inst as usize)
			.unwrap_or(ExecStatus::Halted)
	}

	/// HALT するまで（または上限まで）回す。
	///
	/// * `max_inst` — 安全上限
	pub fn run_until_halt(&mut self, max_inst: u32) -> ExecStatus {
		self.ext_halt = false;
		if self.core.get_exec_status() == ExecStatus::Idle
			|| self.core.get_exec_status() == ExecStatus::Halted
		{
			// リセット直後は Running。idle なら kick。
			if self.core.get_exec_status() == ExecStatus::Idle {
				self.core.set_exec_status(ExecStatus::Running);
			}
		}
		let mut left = max_inst;
		while left > 0 {
			let before = left.min(4096);
			let st = self.run_slice(before);
			left = left.saturating_sub(before);
			if matches!(st, ExecStatus::Halted | ExecStatus::Break | ExecStatus::Step) {
				return st;
			}
			if self.ext_halt {
				self.core.halt();
				return ExecStatus::Halted;
			}
		}
		self.core.get_exec_status()
	}

	/// 物理ワードを読む（テスト用）。
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
		self.core.set_state(&crate::cpuboard::cpu_core::mn1613::CpuRegisterPatch {
			ic: Some(word),
			..Default::default()
		});
		self.core.set_exec_status(ExecStatus::Running);
		Ok(())
	}

	fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError> {
		self.ext_halt = halt;
		if halt {
			self.core.halt();
		} else if self.core.get_exec_status() == ExecStatus::Halted {
			self.core.set_exec_status(ExecStatus::Running);
		}
		Ok(())
	}

	fn pulse_reset(&mut self, reset_vector_word: Option<u32>) -> Result<(), BoardLinkError> {
		if let Some(v) = reset_vector_word {
			self.set_reset_vector(v);
		} else {
			self.set_reset_vector(MONITOR_ENTRY_WORD);
		}
		self.ports.borrow_mut().reset_peripherals();
		self.ext_halt = false;
		self.core.reset(&self.ram);
		Ok(())
	}

	fn is_halted(&self) -> bool {
		self.ext_halt || self.core.get_exec_status() == ExecStatus::Halted
	}
}
