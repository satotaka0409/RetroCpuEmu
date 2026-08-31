//! IO↔CPU ハンドシェイクのディスパッチ。

use std::sync::Arc;

use crate::board_link::{cmd_io_to_cpu, response, BoardLinkError, CpuBoardAgent};
use crate::ioboard::output::lcd_display::LcdDisplay;

use super::lcd::{dispatch_lcd_frame, CMD_LCD_CTRL, CMD_LCD_TEXT};

use super::codec::{
	encode_exec, encode_mem_read, encode_mem_write, read_u32_be, EXEC_WIRE_LEN,
	MEM_RW_WIRE_HEADER_LEN,
};

/// IO→CPU フレームを Agent へディスパッチする。
///
/// - `82h`: 応答 1B（OK/NG）
/// - `83h`: 応答 = データ + 末尾 status
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

/// パネル向けログの最小抽象。
pub trait PanelEventLogger: Send + Sync {
	/// LCD ハンドシェイクイベントを受け取る。
	fn log_lcd_event(&self, event: &LcdLogEvent);
}

/// LCD ハンドシェイクログ 1 件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LcdLogEvent {
	/// コマンド番号（`0x17` / `0x18`）。
	pub cmd: u8,
	/// 応答ステータス。
	pub status: u8,
	/// `17h` kind。
	pub kind: Option<u8>,
	/// `17h` argA。
	pub arg_a: Option<u8>,
	/// `17h` argB。
	pub arg_b: Option<u8>,
	/// `17h` argC。
	pub arg_c: Option<u8>,
	/// `18h` row。
	pub row: Option<u8>,
	/// `18h` col。
	pub col: Option<u8>,
	/// `18h` len。
	pub len: Option<u8>,
	/// `18h` text（ASCII 正規化済み）。
	pub text: Option<String>,
}

#[derive(Debug, Default)]
struct NoopPanelEventLogger;

impl PanelEventLogger for NoopPanelEventLogger {
	fn log_lcd_event(&self, _event: &LcdLogEvent) {}
}

/// CPU→IO フレームへの MVP 応答（未知も OK。ブート待ちスタブ）。
pub fn handle_cpu_to_io(frame: &[u8], lcd: &mut LcdDisplay) -> Vec<u8> {
	let noop = NoopPanelEventLogger;
	handle_cpu_to_io_with_logger(frame, lcd, &noop)
}

/// CPU→IO フレームを処理し、必要ならパネルログを通知する。
pub fn handle_cpu_to_io_with_logger(
	frame: &[u8],
	lcd: &mut LcdDisplay,
	logger: &dyn PanelEventLogger,
) -> Vec<u8> {
	match dispatch_lcd_frame(frame, lcd) {
		Some(status) => {
			if let Some(event) = build_lcd_log_event(frame, status) {
				logger.log_lcd_event(&event);
			}
			vec![status]
		}
		None => vec![response::OK],
	}
}

fn build_lcd_log_event(frame: &[u8], status: u8) -> Option<LcdLogEvent> {
	if frame.is_empty() {
		return None;
	}
	match frame[0] {
		CMD_LCD_CTRL => {
			let kind = frame.get(2).copied().unwrap_or(0);
			let a = frame.get(3).copied().unwrap_or(0);
			let b = frame.get(4).copied().unwrap_or(0);
			let c = frame.get(5).copied().unwrap_or(0);
			Some(LcdLogEvent {
				cmd: CMD_LCD_CTRL,
				status,
				kind: Some(kind),
				arg_a: Some(a),
				arg_b: Some(b),
				arg_c: Some(c),
				row: None,
				col: None,
				len: None,
				text: None,
			})
		}
		CMD_LCD_TEXT => {
			let row = frame.get(1).copied().unwrap_or(0);
			let col = frame.get(2).copied().unwrap_or(0);
			let len_u8 = frame.get(3).copied().unwrap_or(0);
			let len = len_u8 as usize;
			let max = len.min(16).min(frame.len().saturating_sub(4));
			let mut text = String::with_capacity(max);
			for &ch in &frame[4..4 + max] {
				let v = if (0x20..=0x7e).contains(&ch) {
					ch
				} else {
					b' '
				};
				text.push(v as char);
			}
			Some(LcdLogEvent {
				cmd: CMD_LCD_TEXT,
				status,
				kind: None,
				arg_a: None,
				arg_b: None,
				arg_c: None,
				row: Some(row),
				col: Some(col),
				len: Some(len_u8),
				text: Some(text),
			})
		}
		_ => None,
	}
}

/// ハンドシェイクディスパッチャ（状態は持たず Agent へ委譲）。
#[derive(Clone)]
pub struct HandshakeDispatcher {
	logger: Arc<dyn PanelEventLogger>,
}

impl Default for HandshakeDispatcher {
	fn default() -> Self {
		Self::new()
	}
}

impl std::fmt::Debug for HandshakeDispatcher {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.debug_struct("HandshakeDispatcher").finish()
	}
}

/// IO ボード側ハンドシェイク窓口（MVP = [`HandshakeDispatcher`]）。
pub type IoHandshakePeer = HandshakeDispatcher;

impl HandshakeDispatcher {
	/// 新規。
	pub fn new() -> Self {
		Self {
			logger: Arc::new(NoopPanelEventLogger),
		}
	}

	/// ロガー指定で新規作成する。
	pub fn with_logger(logger: Arc<dyn PanelEventLogger>) -> Self {
		Self { logger }
	}

	/// パネルログ出力先を差し替える。
	pub fn set_logger(&mut self, logger: Arc<dyn PanelEventLogger>) {
		self.logger = logger;
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
	pub fn dispatch_from_cpu(&self, frame: &[u8], lcd: &mut LcdDisplay) -> Vec<u8> {
		handle_cpu_to_io_with_logger(frame, lcd, self.logger.as_ref())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::board_link::CpuBoardAgent;
	use std::sync::{Arc, Mutex};

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

	#[derive(Default)]
	struct CaptureLogger {
		events: Mutex<Vec<LcdLogEvent>>,
	}

	impl PanelEventLogger for CaptureLogger {
		fn log_lcd_event(&self, event: &LcdLogEvent) {
			self.events.lock().expect("lock").push(event.clone());
		}
	}

	#[test]
	fn injected_logger_receives_lcd_event() {
		let logger = Arc::new(CaptureLogger::default());
		let mut dispatcher = HandshakeDispatcher::new();
		dispatcher.set_logger(logger.clone());
		let mut lcd = LcdDisplay::new();

		let reply = dispatcher.dispatch_from_cpu(&[CMD_LCD_TEXT, 0, 0, 2, b'O', b'K'], &mut lcd);
		assert_eq!(reply, vec![response::OK]);

		let events = logger.events.lock().expect("lock");
		assert_eq!(events.len(), 1);
		assert_eq!(events[0].cmd, CMD_LCD_TEXT);
		assert_eq!(events[0].status, response::OK);
		assert_eq!(events[0].text.as_deref(), Some("OK"));
	}
}
