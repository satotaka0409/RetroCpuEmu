//! IO ボード側ハンドシェイク（in-process MVP）。
//!
//! ビットバンはせず、フレームを組んで [`CpuBoardAgent`] へ即時ディスパッチする。
//! 線上レイアウトは `HandShake.mdc`（addr32 BE / count32 BE）に合わせる。
//! CPU→IO は MVP で OK スタブ（ブート中の応答待ち用）。

use crate::board_link::{
	cmd_io_to_cpu, response, BoardLinkError, CpuBoardAgent,
};

/// `82h` 線上ヘッダ長（cmd + pad + addr32）。
pub const EXEC_WIRE_LEN: usize = 6;
/// `83h`/`84h` 線上ヘッダ長（cmd + pad + addr32 + count32）。
pub const MEM_RW_WIRE_HEADER_LEN: usize = 10;

/// u32 をビッグエンディアン 4 バイトにする。
pub fn u32_be(v: u32) -> [u8; 4] {
	[
		((v >> 24) & 0xff) as u8,
		((v >> 16) & 0xff) as u8,
		((v >> 8) & 0xff) as u8,
		(v & 0xff) as u8,
	]
}

/// ビッグエンディアン 4 バイトを u32 にする。
pub fn read_u32_be(buf: &[u8]) -> u32 {
	((buf[0] as u32) << 24)
		| ((buf[1] as u32) << 16)
		| ((buf[2] as u32) << 8)
		| (buf[3] as u32)
}

/// `82h` EXEC フレームを組む。
pub fn encode_exec(byte_addr: u32) -> [u8; EXEC_WIRE_LEN] {
	let mut frame = [0u8; EXEC_WIRE_LEN];
	frame[0] = cmd_io_to_cpu::EXEC;
	frame[1] = 0;
	frame[2..6].copy_from_slice(&u32_be(byte_addr));
	frame
}

/// `83h` MEM_READ ヘッダを組む。
pub fn encode_mem_read(byte_addr: u32, count: u32) -> [u8; MEM_RW_WIRE_HEADER_LEN] {
	let mut frame = [0u8; MEM_RW_WIRE_HEADER_LEN];
	frame[0] = cmd_io_to_cpu::MEM_READ;
	frame[1] = 0;
	frame[2..6].copy_from_slice(&u32_be(byte_addr));
	frame[6..10].copy_from_slice(&u32_be(count));
	frame
}

/// `84h` MEM_WRITE フレーム（ヘッダ＋データ）を組む。
pub fn encode_mem_write(byte_addr: u32, data: &[u8]) -> Vec<u8> {
	let n = data.len() as u32;
	let mut frame = Vec::with_capacity(MEM_RW_WIRE_HEADER_LEN + data.len());
	frame.push(cmd_io_to_cpu::MEM_WRITE);
	frame.push(0);
	frame.extend_from_slice(&u32_be(byte_addr));
	frame.extend_from_slice(&u32_be(n));
	frame.extend_from_slice(data);
	frame
}

/// IO→CPU フレームを Agent へディスパッチする。
///
/// - `82h`: 応答 1B（OK/NG）
/// - `83h`: 応答 = データ + 末尾に IO が載せる status は呼び出し側で付与しない。
///   ここではデータのみ返し、成功時は別途 `response::OK` を送る想定。
///   MVP では `(data, status)` をまとめて返す。
/// - `84h`: 応答 1B（OK/NG）
pub fn dispatch_io_to_cpu<A: CpuBoardAgent>(
	agent: &mut A,
	frame: &[u8],
) -> Result<Vec<u8>, BoardLinkError> {
	if frame.is_empty() {
		return Err(BoardLinkError::BadFrame);
	}
	match frame[0] {
		cmd_io_to_cpu::EXEC => {
			if frame.len() < EXEC_WIRE_LEN {
				return Err(BoardLinkError::BadFrame);
			}
			let addr = read_u32_be(&frame[2..6]);
			match agent.hshk_exec(addr) {
				Ok(()) => Ok(vec![response::OK]),
				Err(_) => Ok(vec![response::NG]),
			}
		}
		cmd_io_to_cpu::MEM_READ => {
			if frame.len() < MEM_RW_WIRE_HEADER_LEN {
				return Err(BoardLinkError::BadFrame);
			}
			let addr = read_u32_be(&frame[2..6]);
			let count = read_u32_be(&frame[6..10]);
			match agent.hshk_mem_read(addr, count) {
				Ok(mut data) => {
					if data.len() as u32 != count {
						return Ok(vec![response::NG]);
					}
					data.push(response::OK);
					Ok(data)
				}
				Err(_) => Ok(vec![response::NG]),
			}
		}
		cmd_io_to_cpu::MEM_WRITE => {
			if frame.len() < MEM_RW_WIRE_HEADER_LEN {
				return Err(BoardLinkError::BadFrame);
			}
			let addr = read_u32_be(&frame[2..6]);
			let count = read_u32_be(&frame[6..10]) as usize;
			if frame.len() < MEM_RW_WIRE_HEADER_LEN + count {
				return Err(BoardLinkError::BadFrame);
			}
			let data = &frame[MEM_RW_WIRE_HEADER_LEN..MEM_RW_WIRE_HEADER_LEN + count];
			match agent.hshk_mem_write(addr, data) {
				Ok(()) => Ok(vec![response::OK]),
				Err(_) => Ok(vec![response::NG]),
			}
		}
		_ => Err(BoardLinkError::BadFrame),
	}
}

/// 便利ラッパ: Agent へ `83h` を発行してデータだけ返す。
pub fn mem_read<A: CpuBoardAgent>(
	agent: &mut A,
	byte_addr: u32,
	len: u32,
) -> Result<Vec<u8>, BoardLinkError> {
	let frame = encode_mem_read(byte_addr, len);
	let mut reply = dispatch_io_to_cpu(agent, &frame)?;
	if reply.is_empty() {
		return Err(BoardLinkError::Ng);
	}
	let status = reply[reply.len() - 1];
	reply.pop();
	if status != response::OK {
		return Err(BoardLinkError::Ng);
	}
	if reply.len() as u32 != len {
		return Err(BoardLinkError::Ng);
	}
	Ok(reply)
}

/// 便利ラッパ: Agent へ `84h` を発行する。
pub fn mem_write<A: CpuBoardAgent>(
	agent: &mut A,
	byte_addr: u32,
	data: &[u8],
) -> Result<(), BoardLinkError> {
	let frame = encode_mem_write(byte_addr, data);
	let reply = dispatch_io_to_cpu(agent, &frame)?;
	if reply.first().copied() != Some(response::OK) {
		return Err(BoardLinkError::Ng);
	}
	Ok(())
}

/// 便利ラッパ: Agent へ `82h` を発行する。
pub fn exec<A: CpuBoardAgent>(agent: &mut A, byte_addr: u32) -> Result<(), BoardLinkError> {
	let frame = encode_exec(byte_addr);
	let reply = dispatch_io_to_cpu(agent, &frame)?;
	if reply.first().copied() != Some(response::OK) {
		return Err(BoardLinkError::Ng);
	}
	Ok(())
}

/// CPU→IO フレームへの MVP 応答（未知も OK。ブート待ちスタブ）。
pub fn handle_cpu_to_io_stub(frame: &[u8]) -> Vec<u8> {
	if frame.is_empty() {
		return vec![response::NG];
	}
	// 多くの CPU→IO は末尾に status 1B を返す。MVP は常に OK。
	vec![response::OK]
}

/// ハンドシェイクディスパッチャ（状態は持たず Agent へ委譲）。
#[derive(Debug, Default, Clone, Copy)]
pub struct HandshakeDispatcher;

/// IO ボード側ハンドシェイク窓口（MVP = [`HandshakeDispatcher`]）。
pub type IoHandshakePeer = HandshakeDispatcher;

impl HandshakeDispatcher {
	/// 新規。
	pub fn new() -> Self {
		Self
	}

	/// IO→CPU を処理する。
	pub fn dispatch_to_cpu<A: CpuBoardAgent>(
		&self,
		agent: &mut A,
		frame: &[u8],
	) -> Result<Vec<u8>, BoardLinkError> {
		dispatch_io_to_cpu(agent, frame)
	}

	/// CPU→IO を処理する（スタブ）。
	pub fn dispatch_from_cpu(&self, frame: &[u8]) -> Vec<u8> {
		handle_cpu_to_io_stub(frame)
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::board_link::CpuBoardAgent;

	struct MockRam {
		mem: Vec<u8>,
		halted: bool,
	}

	impl CpuBoardAgent for MockRam {
		fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
			let a = byte_addr as usize;
			if a + data.len() > self.mem.len() {
				return Err(BoardLinkError::Ng);
			}
			self.mem[a..a + data.len()].copy_from_slice(data);
			Ok(())
		}

		fn hshk_mem_read(&mut self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
			let a = byte_addr as usize;
			let n = len as usize;
			if a + n > self.mem.len() {
				return Err(BoardLinkError::Ng);
			}
			Ok(self.mem[a..a + n].to_vec())
		}

		fn hshk_mem_write(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
			self.dma_write_bytes(byte_addr, data)
		}

		fn hshk_exec(&mut self, _byte_addr: u32) -> Result<(), BoardLinkError> {
			self.halted = false;
			Ok(())
		}

		fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError> {
			self.halted = halt;
			Ok(())
		}

		fn pulse_reset(&mut self, _reset_vector_word: Option<u32>) -> Result<(), BoardLinkError> {
			self.halted = true;
			Ok(())
		}

		fn is_halted(&self) -> bool {
			self.halted
		}
	}

	#[test]
	fn mem_read_write_roundtrip() {
		let mut ram = MockRam {
			mem: vec![0; 256],
			halted: true,
		};
		mem_write(&mut ram, 0x10, &[0x12, 0x34]).expect("write");
		let got = mem_read(&mut ram, 0x10, 2).expect("read");
		assert_eq!(got, vec![0x12, 0x34]);
		assert_eq!(ram.mem[0x10], 0x12);
		assert_eq!(ram.mem[0x11], 0x34);
	}

	#[test]
	fn exec_sets_running() {
		let mut ram = MockRam {
			mem: vec![0; 16],
			halted: true,
		};
		exec(&mut ram, 0x0108 * 2).expect("exec");
		assert!(!ram.is_halted());
	}
}
