use std::fmt;

/// DMA 書き込みエラー
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DmaError {
	/// 既に転送中
	Busy,
	/// 実行中で書き込み不可（HALT/RESET 相当でない）
	NotWritable,
	/// アドレスが RAM 範囲外
	OutOfRange { byte_addr: u32 },
}

impl fmt::Display for DmaError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			Self::Busy => write!(f, "DMA already busy"),
			Self::NotWritable => {
				write!(f, "DMA write only allowed during HALT/RESET")
			}
			Self::OutOfRange { byte_addr } => {
				write!(f, "DMA write out of range byteAddr=0x{byte_addr:04X}")
			}
		}
	}
}

impl std::error::Error for DmaError {}
