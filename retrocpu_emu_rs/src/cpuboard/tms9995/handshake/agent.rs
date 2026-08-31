//! TMS9995 CPU ボード側ハンドシェイクエージェント（スタブ）
//!
//! 線ラッチと [`FrameLink`] を束ねる。
//! フルビットバン／コマンドディスパッチは後続で接続する。

use super::board_link::{FrameLink, HandshakeTransport};
use super::wires::HandshakeWires;

/// CPU 側ハンドシェイク橋の最小スタブ。
#[derive(Debug, Default)]
pub struct CpuHandshakeAgent {
	/// IO:0020–0025 に見せる信号バス
	pub wires: HandshakeWires,
	/// 同一プロセス転送（未接続なら None）
	link: Option<FrameLink>,
}

impl CpuHandshakeAgent {
	/// 線のみ初期化し、リンク未接続で作る。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			wires: HandshakeWires::new(),
			link: None,
		}
	}

	/// 既定の [`FrameLink`] を接続して作る。
	///
	/// # Arguments
	/// - `link`: リンクオブジェクト
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn with_link(link: FrameLink) -> Self {
		Self {
			wires: HandshakeWires::new(),
			link: Some(link),
		}
	}

	/// 線とリンクキューをクリアする。
	pub fn reset(&mut self) {
		self.wires.reset();
		if let Some(link) = self.link.as_mut() {
			link.clear();
		}
	}

	/// 転送リンクへの可変参照。未接続なら None。
	///
	/// # Returns
	/// - リンク接続時は `Some(&mut FrameLink)`、未接続なら `None` を返します。
	pub fn link_mut(&mut self) -> Option<&mut FrameLink> {
		self.link.as_mut()
	}

	/// 転送リンクを差し替える（または None で切断）。
	///
	/// # Arguments
	/// - `link`: 新しいリンク
	pub fn attach_link(&mut self, link: Option<FrameLink>) {
		self.link = link;
	}

	/// CPU→IO フレームをリンクへ積む（スタブ。線プロトコルは未シミュ）。
	///
	/// # Arguments
	/// - `frame`: コマンド先頭のバイト列
	///
	/// # Returns
	/// - リンク接続済みなら `true`。未接続なら `false`。
	pub fn enqueue_cpu_to_io(&mut self, frame: &[u8]) -> bool {
		if let Some(link) = self.link.as_mut() {
			link.push_cpu_to_io(frame);
			true
		} else {
			false
		}
	}

	/// IO→CPU 待ちフレームを 1 件取り出す。
	///
	/// # Returns
	/// - 受信データがあれば `Some(frame)`、なければ `None` を返します。
	pub fn dequeue_io_to_cpu(&mut self) -> Option<Vec<u8>> {
		self.link.as_mut()?.pop_io_to_cpu()
	}
}
