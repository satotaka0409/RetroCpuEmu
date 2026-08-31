use super::error::DmaError;
use super::memory::DmaWriteMemory;

/// CPU ボード DMA 受け口。読み込みメソッドは持たない。
#[derive(Debug, Default)]
pub struct CpuDma {
	busy: bool,
	/// HALT/RESET 相当なら true（コア未接続時は既定 true）
	writable: bool,
}

impl CpuDma {
	/// 書き込み可能状態で作る（コア未接続の既定）。
	pub fn new() -> Self {
		Self {
			busy: false,
			writable: true,
		}
	}

	/// DMA セッション中か。
	pub fn is_busy(&self) -> bool {
		self.busy
	}

	/// HALT/RESET 相当かどうかをコア側から反映する。
	pub fn set_writable(&mut self, writable: bool) {
		self.writable = writable;
	}

	/// DMA 書き込み可能か（HALT/RESET 相当）。
	pub fn is_writable(&self) -> bool {
		self.writable
	}

	/// バイト列を BE 語メモリへ書く（奇数末尾は下位 0）。
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
	use crate::cpuboard::mn1613::dma::SharedRam;

	#[test]
	fn write_bytes_be_words() {
		let mut ram = SharedRam::new(16);
		let mut dma = CpuDma::new();
		dma
			.write_bytes(&mut ram, 0x0004, &[0x12, 0x34, 0xAB])
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
