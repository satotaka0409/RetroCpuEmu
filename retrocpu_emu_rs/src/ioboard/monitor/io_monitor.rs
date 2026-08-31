//! 前面パネルのモニター機能（M/R/W/EXEC）をまとめたヘルパ。

use crate::board_link::{BoardLinkError, PanelHost};
use crate::ioboard::setting_area::{align_addr_to_step, normalize_addr_step};

/// モニター操作ヘルパ。
#[derive(Debug, Default, Clone, Copy)]
pub struct IoMonitor;

impl IoMonitor {
	/// アドレス増加数に合わせてワードアドレスを整列する。
	pub fn align_word_addr(word_addr: u32, addr_step: u8) -> u32 {
		align_addr_to_step(word_addr, normalize_addr_step(addr_step))
	}

	/// アドレス増分を返す（設定エリア時は常に 1）。
	pub fn addr_delta(setting_area: bool, addr_step: u8) -> u8 {
		if setting_area {
			1
		} else {
			normalize_addr_step(addr_step)
		}
	}

	/// ワードアドレスを加減算する（設定エリア時は 00h-FFh でラップ）。
	pub fn shift_word_addr(word_addr: u32, delta: i32, setting_area: bool) -> u32 {
		if setting_area {
			((word_addr as i32).wrapping_add(delta) as u32) & 0xff
		} else {
			(word_addr as i32).wrapping_add(delta) as u32
		}
	}

	/// 指定ワードアドレスを読む。
	pub fn read_word<H: PanelHost>(
		host: &mut H,
		word_addr: u32,
		setting_area: bool,
	) -> Result<u16, BoardLinkError> {
		if setting_area {
			return Ok(u16::from(host.read_setting_byte((word_addr & 0xff) as u8)));
		}
		let bytes = host.mem_read(word_addr << 1, 2)?;
		if bytes.len() < 2 {
			return Err(BoardLinkError::Ng);
		}
		Ok((u16::from(bytes[0]) << 8) | u16::from(bytes[1]))
	}

	/// 指定ワードアドレスへ書く。
	pub fn write_word<H: PanelHost>(
		host: &mut H,
		word_addr: u32,
		data_word: u16,
		setting_area: bool,
	) -> Result<(), BoardLinkError> {
		if setting_area {
			host.write_setting_byte((word_addr & 0xff) as u8, (data_word & 0xff) as u8);
			return Ok(());
		}
		let be = [(data_word >> 8) as u8, (data_word & 0xff) as u8];
		host.mem_write(word_addr << 1, &be)
	}

	/// ワードアドレスをバイトアドレスへ変換して実行開始する。
	pub fn exec_word<H: PanelHost>(host: &mut H, word_addr: u32) -> Result<(), BoardLinkError> {
		host.exec(word_addr << 1)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	struct MockHost {
		mem: Vec<u8>,
		settings: [u8; 256],
		exec_addr: Option<u32>,
	}

	impl Default for MockHost {
		fn default() -> Self {
			Self {
				mem: Vec::new(),
				settings: [0; 256],
				exec_addr: None,
			}
		}
	}

	impl MockHost {
		fn with_mem(mem: Vec<u8>) -> Self {
			Self {
				mem,
				..Self::default()
			}
		}
	}

	impl PanelHost for MockHost {
		fn mem_read(&mut self, addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
			let a = addr as usize;
			let l = len as usize;
			if a + l > self.mem.len() {
				return Err(BoardLinkError::Ng);
			}
			Ok(self.mem[a..a + l].to_vec())
		}

		fn mem_write(&mut self, addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
			let a = addr as usize;
			if a + data.len() > self.mem.len() {
				return Err(BoardLinkError::Ng);
			}
			self.mem[a..a + data.len()].copy_from_slice(data);
			Ok(())
		}

		fn exec(&mut self, addr: u32) -> Result<(), BoardLinkError> {
			self.exec_addr = Some(addr);
			Ok(())
		}

		fn start_run(&mut self) -> Result<(), BoardLinkError> {
			Ok(())
		}

		fn request_halt(&mut self) -> Result<(), BoardLinkError> {
			Ok(())
		}

		fn reset_and_reload_monitor(&mut self) -> Result<(), BoardLinkError> {
			Ok(())
		}

		fn cpu_halted(&self) -> bool {
			true
		}

		fn read_setting_byte(&self, byte_addr: u8) -> u8 {
			self.settings[byte_addr as usize]
		}

		fn write_setting_byte(&mut self, byte_addr: u8, value: u8) {
			self.settings[byte_addr as usize] = value;
		}
	}

	#[test]
	fn read_write_word_in_monitor_mode() {
		let mut host = MockHost::with_mem(vec![0x12, 0x34, 0x56, 0x78]);
		let v = IoMonitor::read_word(&mut host, 1, false).expect("read should succeed");
		assert_eq!(v, 0x5678);
		IoMonitor::write_word(&mut host, 0, 0xabcd, false).expect("write should succeed");
		assert_eq!(host.mem[..2], [0xab, 0xcd]);
	}

	#[test]
	fn read_write_word_in_setting_area_mode() {
		let mut host = MockHost::default();
		host.settings[0x10] = 0xaa;
		let v = IoMonitor::read_word(&mut host, 0x10, true).expect("read should succeed");
		assert_eq!(v, 0x00aa);
		IoMonitor::write_word(&mut host, 0x10, 0x12ff, true).expect("write should succeed");
		assert_eq!(host.settings[0x10], 0xff);
	}

	#[test]
	fn exec_word_uses_byte_address() {
		let mut host = MockHost::default();
		IoMonitor::exec_word(&mut host, 0x1234).expect("exec should succeed");
		assert_eq!(host.exec_addr, Some(0x2468));
	}

	#[test]
	fn address_helpers_follow_mode() {
		assert_eq!(IoMonitor::align_word_addr(5, 2), 4);
		assert_eq!(IoMonitor::addr_delta(false, 2), 2);
		assert_eq!(IoMonitor::addr_delta(true, 2), 1);
		assert_eq!(IoMonitor::shift_word_addr(0xff, 1, true), 0);
	}
}
