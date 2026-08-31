//! IO↔CPU ハンドシェイクのフレーム符号化/復号。

use crate::board_link::cmd_io_to_cpu;

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
	((buf[0] as u32) << 24) | ((buf[1] as u32) << 16) | ((buf[2] as u32) << 8) | (buf[3] as u32)
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
