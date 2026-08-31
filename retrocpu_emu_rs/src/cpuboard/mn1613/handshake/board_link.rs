//! 同一プロセス内の CPU↔IO フレーム受け渡し（線シミュレーション上位互換）
//!
//! クレート直下の `board_link::BoardLink`（Agent RPC）とは別物。
//! 実 GPIO ビットバンを差し替えられるよう [`HandshakeTransport`] で抽象化する。

use std::collections::VecDeque;

/// ボード間ハンドシェイク転送の最小面。
/// 実機線シミュレーション実装で置き換え可能。
pub trait HandshakeTransport {
	/// CPU→IO 方向にフレームを積む（奇数長は呼び出し側で 0 パッド可）。
	///
	/// # Arguments
	/// - `frame`: コマンド先頭のバイト列
	fn push_cpu_to_io(&mut self, frame: &[u8]);

	/// CPU→IO キュー先頭を取り出す。空なら None。
	fn pop_cpu_to_io(&mut self) -> Option<Vec<u8>>;

	/// IO→CPU 方向にフレームを積む。
	///
	/// # Arguments
	/// - `frame`: 応答または IO 起点コマンド
	fn push_io_to_cpu(&mut self, frame: &[u8]);

	/// IO→CPU キュー先頭を取り出す。空なら None。
	fn pop_io_to_cpu(&mut self) -> Option<Vec<u8>>;

	/// いずれかのキューに未処理フレームがあるか。
	fn has_pending(&self) -> bool;
}

/// 同一プロセス用の両方向フレームキュー（線上バイト列の受け皿）。
#[derive(Debug, Default, Clone)]
pub struct FrameLink {
	cpu_to_io: VecDeque<Vec<u8>>,
	io_to_cpu: VecDeque<Vec<u8>>,
}

impl FrameLink {
	/// 空のリンクを作る。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self::default()
	}

	/// 両キューを空にする。
	pub fn clear(&mut self) {
		self.cpu_to_io.clear();
		self.io_to_cpu.clear();
	}

	/// CPU→IO 待ちフレーム数。
	///
	/// # Returns
	/// - 件数または長さを返します。
	pub fn cpu_to_io_len(&self) -> usize {
		self.cpu_to_io.len()
	}

	/// IO→CPU 待ちフレーム数。
	///
	/// # Returns
	/// - 件数または長さを返します。
	pub fn io_to_cpu_len(&self) -> usize {
		self.io_to_cpu.len()
	}
}

impl HandshakeTransport for FrameLink {
	fn push_cpu_to_io(&mut self, frame: &[u8]) {
		self.cpu_to_io.push_back(frame.to_vec());
	}

	fn pop_cpu_to_io(&mut self) -> Option<Vec<u8>> {
		self.cpu_to_io.pop_front()
	}

	fn push_io_to_cpu(&mut self, frame: &[u8]) {
		self.io_to_cpu.push_back(frame.to_vec());
	}

	fn pop_io_to_cpu(&mut self) -> Option<Vec<u8>> {
		self.io_to_cpu.pop_front()
	}

	fn has_pending(&self) -> bool {
		!self.cpu_to_io.is_empty() || !self.io_to_cpu.is_empty()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn round_trip_queues() {
		let mut link = FrameLink::new();
		link.push_cpu_to_io(&[0x11]);
		link.push_io_to_cpu(&[0x00]);
		assert_eq!(link.pop_cpu_to_io(), Some(vec![0x11]));
		assert_eq!(link.pop_io_to_cpu(), Some(vec![0x00]));
		assert!(!link.has_pending());
	}
}
