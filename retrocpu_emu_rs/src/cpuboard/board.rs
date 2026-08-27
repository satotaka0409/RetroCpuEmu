//! CPU ボード束ね役（RAM・IO・DMA・ハンドシェイク）
//!
//! MN1613 コアは別エージェント書き換え中のため、接続は `Option` / トレイトで後付けする。
//! コア付きの本番エージェントは [`crate::system::Mn1613CpuAgent`]。

use crate::board_link::{BoardLinkError, CpuBoardAgent};
use crate::cpuboard::dma::{CpuDma, DmaError, SharedRam};
use crate::cpuboard::handshake::{CpuHandshakeAgent, FrameLink};
use crate::cpuboard::io_ports::{IoPorts, PendingIrq, MONITOR_ENTRY_WORD};
use crate::cpuboard::mn1613::AddrBusAccess;

/// 後から差し込む CPU コア最小面（書き換え中の実コアと置き換え可能）
pub trait CpuCoreHandle {
	/// アーキテクチャ状態をリセットする。
	fn reset(&mut self);
	/// 1 ステップ相当を進める（コア未実装時は no-op でよい）。
	fn tick(&mut self);
	/// HALT/RESET 相当で DMA 可なら true。
	fn dma_writable(&self) -> bool;
}

/// CPU ボード。コア未接続でも周辺は単体で動く。
#[derive(Debug)]
pub struct CpuBoard {
	/// 共有物理 RAM（DMA 書き込み先）
	pub ram: SharedRam,
	/// IO ポート・比較器・ステップ
	pub io: IoPorts,
	/// DMA 受け口
	pub dma: CpuDma,
	/// ハンドシェイクエージェント（スタブ）
	pub handshake: CpuHandshakeAgent,
	/// パネル／IO から見た HALT（コア未接続時の表示用）。
	halted: bool,
}

impl Default for CpuBoard {
	fn default() -> Self {
		Self::new()
	}
}

impl CpuBoard {
	/// MN1613 物理 RAM・既定 IO・空リンク付きハンドシェイクで作る。
	pub fn new() -> Self {
		Self {
			ram: SharedRam::mn1613(),
			io: IoPorts::new(),
			dma: CpuDma::new(),
			handshake: CpuHandshakeAgent::with_link(FrameLink::new()),
			halted: true,
		}
	}

	/// 周辺とハンドシェイクを初期化し、リセットベクタをモニター既定へ戻す。
	/// コア接続時は呼び出し側で `core.reset()` も行う。
	pub fn reset(&mut self) {
		self.io.reset();
		self.dma = CpuDma::new();
		self.handshake.reset();
		self.halted = true;
		self.dma.set_writable(true);
		self.set_reset_vector(MONITOR_ENTRY_WORD);
	}

	/// 1 ティック。コア未接続時は周辺のみ（現状 no-op）。
	/// コア接続後は `on_instruction_fetch` / IRQ 配送をここで結ぶ想定。
	pub fn tick(&mut self) {
		// コア API 確定後に step / probe / take_pending_irq を接続する。
	}

	/// HALT 時のみ DMA でバイト列を書く。
	/// @param byte_addr バイトアドレス
	/// @param data 書き込むバイト列
	pub fn dma_write_bytes(
		&mut self,
		byte_addr: u32,
		data: &[u8],
	) -> Result<(), DmaError> {
		self.dma.set_writable(self.halted);
		self.dma.write_bytes(&mut self.ram, byte_addr, data)
	}

	/// コアハンドル付きで DMA 書き込み（書き込み可否をコアから取る）。
	/// @param core CPU コア
	/// @param byte_addr バイトアドレス
	/// @param data 書き込むバイト列
	pub fn dma_write_bytes_with_core(
		&mut self,
		core: &impl CpuCoreHandle,
		byte_addr: u32,
		data: &[u8],
	) -> Result<(), DmaError> {
		self.dma.set_writable(core.dma_writable());
		self.dma.write_bytes(&mut self.ram, byte_addr, data)
	}

	/// IO:0 リセットベクタ表先頭を設定する。
	/// @param word_addr ワードアドレス
	pub fn set_reset_vector(&mut self, word_addr: u32) {
		self.io.set_reset_vector(word_addr);
	}

	/// 現在のリセットベクタ（ワード）。
	pub fn reset_vector(&self) -> u32 {
		self.io.reset_vector()
	}

	/// 比較器 probe の薄いラッパ（コアの MEM/IO フックから呼ぶ）。
	/// @param access バスアクセス
	pub fn probe_addr(&mut self, access: &AddrBusAccess) -> Option<usize> {
		self.io.probe_addr(access)
	}

	/// 命令フェッチ時のステップ判定。
	/// @param word 命令語
	pub fn on_instruction_fetch(&mut self, word: u16) -> bool {
		self.io.on_instruction_fetch(word)
	}

	/// 保留 IRQ を取り出す。
	pub fn take_pending_irq(&mut self) -> Option<PendingIrq> {
		self.io.take_pending_irq()
	}

	/// IO リード（コアの RD コールバックから委譲）。
	/// @param port ポート番号
	pub fn io_read(&mut self, port: u16) -> u16 {
		self.io.read(port)
	}

	/// IO ライト（コアの WT コールバックから委譲）。
	/// @param port ポート番号
	/// @param val 16bit
	pub fn io_write(&mut self, port: u16, val: u16) {
		self.io.write(port, val);
	}

	/// パネル表示用の HALT 状態。
	pub fn is_halted(&self) -> bool {
		self.halted
	}
}

impl CpuBoardAgent for CpuBoard {
	fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.dma.set_writable(self.halted);
		self.dma
			.write_bytes(&mut self.ram, byte_addr, data)
			.map_err(|_| BoardLinkError::Ng)
	}

	fn hshk_mem_read(&mut self, byte_addr: u32, len: u32) -> Result<Vec<u8>, BoardLinkError> {
		self.ram
			.read_bytes(byte_addr, len)
			.map_err(|_| BoardLinkError::Ng)
	}

	fn hshk_mem_write(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), BoardLinkError> {
		self.ram
			.write_bytes_direct(byte_addr, data)
			.map_err(|_| BoardLinkError::Ng)
	}

	fn hshk_exec(&mut self, _byte_addr: u32) -> Result<(), BoardLinkError> {
		self.halted = false;
		self.dma.set_writable(false);
		Ok(())
	}

	fn set_halt(&mut self, halt: bool) -> Result<(), BoardLinkError> {
		self.halted = halt;
		self.dma.set_writable(halt);
		Ok(())
	}

	fn pulse_reset(&mut self, reset_vector_word: Option<u32>) -> Result<(), BoardLinkError> {
		let v = reset_vector_word.unwrap_or(MONITOR_ENTRY_WORD);
		self.reset();
		self.set_reset_vector(v);
		Ok(())
	}

	fn is_halted(&self) -> bool {
		self.halted
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn dma_and_reset_vector() {
		let mut board = CpuBoard::new();
		assert_eq!(board.reset_vector(), 0x0108);
		board.set_reset_vector(0x0200);
		board
			.dma_write_bytes(0x100, &[0xDE, 0xAD])
			.unwrap();
		assert_eq!(board.ram.read_word(0x80), 0xDEAD);
		board.reset();
		assert_eq!(board.reset_vector(), 0x0108);
	}
}
