//! CPU ボード側 DMA（書き込み専用）
//! 根拠: ioboard.mdc — IO→CPU は書き込みのみ。読みはハンドシェイク 13h。
//!
//! バイト列をビッグエンディアン語メモリへ書く（Intel HEX DMA と同じ詰め方）。

use std::fmt;

/// MN1613 物理ワード空間サイズ（18bit = 256K ワード）
pub const MN1613_PHYS_WORDS: usize = 0x4_0000;

/// DMA 書き込みエラー
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DmaError {
	/// 既に転送中
	Busy,
	/// 実行中で書き込み不可（HALT/RESET 相当でない）
	NotWritable,
	/// アドレスが RAM 範囲外
	OutOfRange { word_addr: u32 },
}

impl fmt::Display for DmaError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Busy => write!(f, "DMA already busy"),
			Self::NotWritable => {
				write!(f, "DMA write only allowed during HALT/RESET")
			}
			Self::OutOfRange { word_addr } => {
				write!(f, "DMA write out of range wordAddr=0x{word_addr:05X}")
			}
		}
	}
}

impl std::error::Error for DmaError {}

/// 書き込み専用メモリアダプタ（読み込み API を持たない）
pub trait DmaWriteMemory {
	/// 1 ワード書く（ビッグエンディアン語）。
	///
	/// # Arguments
	/// - `word_addr`: 物理ワードアドレス
	/// - `value`: 16bit 値
	fn write_word(&mut self, word_addr: u32, value: u16) -> Result<(), DmaError>;
}

/// 共有 RAM（ワード配列、BE 語）
#[derive(Debug, Clone)]
pub struct SharedRam {
	words: Vec<u16>,
}

impl SharedRam {
	/// 指定ワード数で 0 埋め RAM を確保する。
	///
	/// # Arguments
	/// - `size_words`: ワード数（MN1613 は通常 `MN1613_PHYS_WORDS`）
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new(size_words: usize) -> Self {
		Self {
			words: vec![0; size_words],
		}
	}

	/// MN1613 物理空間（256K ワード）を確保する。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn mn1613() -> Self {
		Self::new(MN1613_PHYS_WORDS)
	}

	/// ワード数。
	///
	/// # Returns
	/// - 件数または長さを返します。
	pub fn len_words(&self) -> usize {
		self.words.len()
	}

	/// ワードを読む（DMA 面には出さない。CPU コア／テスト用）。
	///
	/// # Arguments
	/// - `word_addr`: 物理ワードアドレス
	///
	/// # Returns
	/// - 16bit 値を返します。
	pub fn read_word(&self, word_addr: u32) -> u16 {
		self.words
			.get(word_addr as usize)
			.copied()
			.unwrap_or(0)
	}

	/// バイト列を読む（ビッグエンディアン語の分解。ハンドシェイク `83h` 用）。
	///
	/// # Arguments
	/// - `byte_addr`: 開始バイトアドレス
	/// - `len`: バイト数
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn read_bytes(&self, byte_addr: u32, len: u32) -> Result<Vec<u8>, DmaError> {
		let mut out = Vec::with_capacity(len as usize);
		for i in 0..len {
			let a = byte_addr.wrapping_add(i);
			let word_addr = a / 2;
			if word_addr as usize >= self.words.len() {
				return Err(DmaError::OutOfRange { word_addr });
			}
			let word = self.words[word_addr as usize];
			out.push(if (a & 1) == 0 {
				(word >> 8) as u8
			} else {
				(word & 0xff) as u8
			});
		}
		Ok(out)
	}

	/// バイト列を直接書く（ハンドシェイク `84h`。DMA 可否は見ない）。
	///
	/// # Arguments
	/// - `byte_addr`: 開始バイトアドレス
	/// - `data`: 書き込むバイト列
	///
	/// # Errors
	/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
	pub fn write_bytes_direct(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), DmaError> {
		for (i, &b) in data.iter().enumerate() {
			let a = byte_addr.wrapping_add(i as u32);
			let word_addr = a / 2;
			let idx = word_addr as usize;
			let Some(slot) = self.words.get_mut(idx) else {
				return Err(DmaError::OutOfRange { word_addr });
			};
			if (a & 1) == 0 {
				*slot = (*slot & 0x00ff) | (u16::from(b) << 8);
			} else {
				*slot = (*slot & 0xff00) | u16::from(b);
			}
		}
		Ok(())
	}

	/// 内部スライス（テスト用）。
	///
	/// # Returns
	/// - 内部ワード配列への読み取り専用参照を返します。
	pub fn as_slice(&self) -> &[u16] {
		&self.words
	}
}

impl DmaWriteMemory for SharedRam {
	fn write_word(&mut self, word_addr: u32, value: u16) -> Result<(), DmaError> {
		let idx = word_addr as usize;
		if let Some(slot) = self.words.get_mut(idx) {
			*slot = value;
			Ok(())
		} else {
			Err(DmaError::OutOfRange { word_addr })
		}
	}
}

/// CPU ボード DMA 受け口。読み込みメソッドは持たない。
#[derive(Debug, Default)]
pub struct CpuDma {
	busy: bool,
	/// HALT/RESET 相当なら true（コア未接続時は既定 true）
	writable: bool,
}

impl CpuDma {
	/// 書き込み可能状態で作る（コア未接続の既定）。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			busy: false,
			writable: true,
		}
	}

	/// DMA セッション中か。
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn is_busy(&self) -> bool {
		self.busy
	}

	/// HALT/RESET 相当かどうかをコア側から反映する。
	///
	/// # Arguments
	/// - `writable`: `true` なら DMA 書き込み可
	pub fn set_writable(&mut self, writable: bool) {
		self.writable = writable;
	}

	/// DMA 書き込み可能か（HALT/RESET 相当）。
	///
	/// # Returns
	/// - 条件成立時は `true`、それ以外は `false` を返します。
	pub fn is_writable(&self) -> bool {
		self.writable
	}

	/// バイト列を BE 語メモリへ書く（奇数末尾は下位 0）。
	///
	/// # Arguments
	/// - `mem`: 書き込み先
	/// - `byte_addr`: バイトアドレス（wordAddr×2）
	/// - `data`: 書き込むバイト列
	pub fn write_bytes(
		&mut self,
		mem: &mut impl DmaWriteMemory,
		byte_addr: u32,
		data: &[u8],
	) -> Result<(), DmaError> {
		self.begin()?;
		let result = (|| {
			let mut offset = 0usize;
			let mut addr = byte_addr;
			while offset < data.len() {
				if !self.writable {
					return Err(DmaError::NotWritable);
				}
				let hi = data[offset];
				let lo = if offset + 1 < data.len() {
					data[offset + 1]
				} else {
					0
				};
				let word = (u16::from(hi) << 8) | u16::from(lo);
				let word_addr = addr / 2;
				mem.write_word(word_addr, word)?;
				offset += 2;
				addr = addr.wrapping_add(2);
			}
			Ok(())
		})();
		self.end();
		result
	}

	/// ワード列を書く。
	///
	/// # Arguments
	/// - `mem`: 書き込み先
	/// - `word_addr`: 開始ワードアドレス
	/// - `words`: 16bit 値列
	pub fn write_words(
		&mut self,
		mem: &mut impl DmaWriteMemory,
		word_addr: u32,
		words: &[u16],
	) -> Result<(), DmaError> {
		self.begin()?;
		let result = (|| {
			let mut a = word_addr;
			for &w in words {
				if !self.writable {
					return Err(DmaError::NotWritable);
				}
				mem.write_word(a, w)?;
				a = a.wrapping_add(1);
			}
			Ok(())
		})();
		self.end();
		result
	}

	fn begin(&mut self) -> Result<(), DmaError> {
		if self.busy {
			return Err(DmaError::Busy);
		}
		if !self.writable {
			return Err(DmaError::NotWritable);
		}
		self.busy = true;
		Ok(())
	}

	fn end(&mut self) {
		self.busy = false;
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn write_bytes_be_words() {
		let mut ram = SharedRam::new(16);
		let mut dma = CpuDma::new();
		dma.write_bytes(&mut ram, 0x0004, &[0x12, 0x34, 0xAB])
			.unwrap();
		assert_eq!(ram.read_word(2), 0x1234);
		assert_eq!(ram.read_word(3), 0xAB00);
	}

	#[test]
	fn rejects_when_not_writable() {
		let mut ram = SharedRam::new(4);
		let mut dma = CpuDma::new();
		dma.set_writable(false);
		assert_eq!(
			dma.write_bytes(&mut ram, 0, &[0x00, 0x01]),
			Err(DmaError::NotWritable)
		);
	}
}
