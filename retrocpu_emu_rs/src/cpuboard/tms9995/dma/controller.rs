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

	/// バイト列を 1 バイト単位で書く。
	pub fn write_bytes(
		&mut self,
		mem: &mut impl DmaWriteMemory,
		byte_addr: u32,
		data: &[u8],
	) -> Result<(), DmaError> {
		self.begin()?;
		let result = (|| {
			for (i, b) in data.iter().copied().enumerate() {
				if !self.writable {
					return Err(DmaError::NotWritable);
				}
				let addr = byte_addr.wrapping_add(i as u32);
				mem.write_byte(addr, b)?;
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
	use crate::cpuboard::tms9995::dma::SharedRam;

	#[test]
	fn write_bytes_by_byte_addr() {
		let mut ram = SharedRam::new(8);
		let mut dma = CpuDma::new();
		dma.write_bytes(&mut ram, 0x0002, &[0x12, 0x34, 0xAB])
			.unwrap();
		assert_eq!(ram.read_byte(0x0002), 0x12);
		assert_eq!(ram.read_byte(0x0003), 0x34);
		assert_eq!(ram.read_byte(0x0004), 0xAB);
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
