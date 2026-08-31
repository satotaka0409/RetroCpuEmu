use super::error::DmaError;

/// TMS9995 物理アドレス空間サイズ（64KBytes）
pub const TMS9995_PHYS_BYTES: usize = 0x1_0000;

/// 書き込み専用メモリアダプタ（読み込み API を持たない）
pub trait DmaWriteMemory {
	/// 1 バイト書く。
	fn write_byte(&mut self, byte_addr: u32, value: u8) -> Result<(), DmaError>;
}

/// 共有 RAM（バイト配列）
#[derive(Debug, Clone)]
pub struct SharedRam {
	bytes: Vec<u8>,
}

impl SharedRam {
	/// 指定バイト数で 0 埋め RAM を確保する。
	pub fn new(size_bytes: usize) -> Self {
		Self {
			bytes: vec![0; size_bytes],
		}
	}

	/// TMS9995 既定物理空間（64KBytes）を確保する。
	pub fn tms9995() -> Self {
		Self::new(TMS9995_PHYS_BYTES)
	}

	/// バイト数。
	pub fn len_bytes(&self) -> usize {
		self.bytes.len()
	}

	/// バイトを読む（DMA 面には出さない。CPU コア／テスト用）。
	pub fn read_byte(&self, byte_addr: u32) -> u8 {
		self.bytes.get(byte_addr as usize).copied().unwrap_or(0)
	}

	/// バイト列を読む（ハンドシェイク `83h` 用）。
	pub fn read_bytes(&self, byte_addr: u32, len: u32) -> Result<Vec<u8>, DmaError> {
		let start = byte_addr as usize;
		let end = start.saturating_add(len as usize);
		if end > self.bytes.len() {
			let bad = if start >= self.bytes.len() {
				byte_addr
			} else {
				byte_addr.wrapping_add((len.saturating_sub(1)) as u32)
			};
			return Err(DmaError::OutOfRange { byte_addr: bad });
		}
		Ok(self.bytes[start..end].to_vec())
	}

	/// バイト列を直接書く（ハンドシェイク `84h`。DMA 可否は見ない）。
	pub fn write_bytes_direct(&mut self, byte_addr: u32, data: &[u8]) -> Result<(), DmaError> {
		for (i, &b) in data.iter().enumerate() {
			let a = byte_addr.wrapping_add(i as u32);
			let idx = a as usize;
			let Some(slot) = self.bytes.get_mut(idx) else {
				return Err(DmaError::OutOfRange { byte_addr: a });
			};
			*slot = b;
		}
		Ok(())
	}

	/// 内部スライス（テスト用）。
	pub fn as_slice(&self) -> &[u8] {
		&self.bytes
	}
}

impl DmaWriteMemory for SharedRam {
	fn write_byte(&mut self, byte_addr: u32, value: u8) -> Result<(), DmaError> {
		let idx = byte_addr as usize;
		if let Some(slot) = self.bytes.get_mut(idx) {
			*slot = value;
			Ok(())
		} else {
			Err(DmaError::OutOfRange { byte_addr })
		}
	}
}
