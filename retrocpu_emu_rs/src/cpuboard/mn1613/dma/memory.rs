use super::error::DmaError;

/// MN1613 物理ワード空間サイズ（18bit = 256K ワード）
pub const MN1613_PHYS_WORDS: usize = 0x4_0000;

/// 書き込み専用メモリアダプタ（読み込み API を持たない）
pub trait DmaWriteMemory {
	/// 1 ワード書く（ビッグエンディアン語）。
	fn write_word(&mut self, word_addr: u32, value: u16) -> Result<(), DmaError>;
}

/// 共有 RAM（ワード配列、BE 語）
#[derive(Debug, Clone)]
pub struct SharedRam {
	words: Vec<u16>,
}

impl SharedRam {
	/// 指定ワード数で 0 埋め RAM を確保する。
	pub fn new(size_words: usize) -> Self {
		Self {
			words: vec![0; size_words],
		}
	}

	/// MN1613 物理空間（256K ワード）を確保する。
	pub fn mn1613() -> Self {
		Self::new(MN1613_PHYS_WORDS)
	}

	/// ワード数。
	pub fn len_words(&self) -> usize {
		self.words.len()
	}

	/// ワードを読む（DMA 面には出さない。CPU コア／テスト用）。
	pub fn read_word(&self, word_addr: u32) -> u16 {
		self.words.get(word_addr as usize).copied().unwrap_or(0)
	}

	/// バイト列を読む（ビッグエンディアン語の分解。ハンドシェイク `83h` 用）。
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
