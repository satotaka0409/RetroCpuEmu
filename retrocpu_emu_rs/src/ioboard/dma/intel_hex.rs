//! Intel HEX パーサ／DMA 展開。
//!
//! 根拠: `ioboard.mdc`（HEX ロードは DMA。未記録番地は触らない）、
//! TS `code_test/intel_hex.ts` / `intel_hex_dma.ts`。

/// DMA 1 回分の連続バイト列（穴は別チャンク）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntelHexDmaChunk {
	/// 開始バイトアドレス。
	pub byte_addr: u32,
	/// 連続データ。
	pub data: Vec<u8>,
}

/// Intel HEX を DMA 用チャンクにしたもの。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntelHexDmaPlan {
	/// 連続区間（アドレス昇順）。
	pub chunks: Vec<IntelHexDmaChunk>,
	/// データレコードのバイト数。
	pub bytes_written: u32,
	/// 最小バイトアドレス。データ無しは 0。
	pub min_addr: u32,
	/// 最大バイトアドレス。データ無しは `None`。
	pub max_addr: Option<u32>,
}

/// HEX パース失敗。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntelHexError {
	/// 人間可読メッセージ。
	pub message: String,
}

impl std::fmt::Display for IntelHexError {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		write!(f, "{}", self.message)
	}
}

impl std::error::Error for IntelHexError {}

/// レコードのチェックサムを検証する（総和下位 8bit が 0）。
fn checksum_ok(bytes: &[u8]) -> bool {
	let mut sum: u8 = 0;
	for b in bytes {
		sum = sum.wrapping_add(*b);
	}
	sum == 0
}

/// データレコードを順に渡す。EOF（type 01）必須。
fn walk_intel_hex_data<F>(hex_text: &str, mut on_data: F) -> Result<(), IntelHexError>
where
	F: FnMut(u32, &[u8]),
{
	let mut base: u32 = 0;
	let mut saw_eof = false;
	for (li, raw_line) in hex_text.replace("\r\n", "\n").split('\n').enumerate() {
		let raw = raw_line.trim();
		if raw.is_empty() {
			continue;
		}
		if !raw.starts_with(':') {
			return Err(IntelHexError {
				message: format!("Intel HEX line {}: missing ':'", li + 1),
			});
		}
		let hex = &raw[1..];
		if hex.len() < 10 || hex.len() % 2 != 0 {
			return Err(IntelHexError {
				message: format!("Intel HEX line {}: bad length", li + 1),
			});
		}
		let mut bytes = Vec::with_capacity(hex.len() / 2);
		for i in (0..hex.len()).step_by(2) {
			let b = u8::from_str_radix(&hex[i..i + 2], 16).map_err(|_| IntelHexError {
				message: format!("Intel HEX line {}: bad hex", li + 1),
			})?;
			bytes.push(b);
		}
		if !checksum_ok(&bytes) {
			return Err(IntelHexError {
				message: format!("Intel HEX line {}: checksum error", li + 1),
			});
		}
		let count = bytes[0] as usize;
		let addr = ((bytes[1] as u32) << 8) | (bytes[2] as u32);
		let typ = bytes[3];
		if 4 + count > bytes.len() - 1 {
			return Err(IntelHexError {
				message: format!("Intel HEX line {}: count overflow", li + 1),
			});
		}
		let data = &bytes[4..4 + count];
		match typ {
			0x00 => on_data(base.wrapping_add(addr), data),
			0x01 => {
				saw_eof = true;
				break;
			}
			0x02 => {
				if data.len() != 2 {
					return Err(IntelHexError {
						message: format!("Intel HEX line {}: type 02", li + 1),
					});
				}
				base = (((data[0] as u32) << 8) | (data[1] as u32)) << 4;
			}
			0x04 => {
				if data.len() != 2 {
					return Err(IntelHexError {
						message: format!("Intel HEX line {}: type 04", li + 1),
					});
				}
				base = (((data[0] as u32) << 8) | (data[1] as u32)) << 16;
			}
			_ => {}
		}
	}
	if !saw_eof {
		return Err(IntelHexError {
			message: "Intel HEX: missing EOF record (type 01)".into(),
		});
	}
	Ok(())
}

/// Intel HEX を DMA 用の連続チャンクにする（レコード間の穴は 0 埋めしない）。
///
/// # Arguments
/// - `hex_text`: 関数に渡す値
///
/// # Errors
/// - 入力値不正や範囲外アクセスなどの異常時にエラーを返します
pub fn intel_hex_to_dma_plan(hex_text: &str) -> Result<IntelHexDmaPlan, IntelHexError> {
	let mut raw: Vec<(u32, Vec<u8>)> = Vec::new();
	walk_intel_hex_data(hex_text, |abs, data| {
		if data.is_empty() {
			return;
		}
		if let Some(last) = raw.last_mut() {
			if last.0.wrapping_add(last.1.len() as u32) == abs {
				last.1.extend_from_slice(data);
				return;
			}
		}
		raw.push((abs, data.to_vec()));
	})?;

	let chunks: Vec<IntelHexDmaChunk> = raw
		.into_iter()
		.map(|(byte_addr, data)| IntelHexDmaChunk { byte_addr, data })
		.collect();

	let mut bytes_written: u32 = 0;
	let mut min_addr = u32::MAX;
	let mut max_addr: Option<u32> = None;
	for c in &chunks {
		bytes_written = bytes_written.wrapping_add(c.data.len() as u32);
		if c.data.is_empty() {
			continue;
		}
		if c.byte_addr < min_addr {
			min_addr = c.byte_addr;
		}
		let hi = c.byte_addr.wrapping_add(c.data.len() as u32).wrapping_sub(1);
		max_addr = Some(match max_addr {
			Some(m) => m.max(hi),
			None => hi,
		});
	}
	if bytes_written == 0 {
		min_addr = 0;
		max_addr = None;
	}
	Ok(IntelHexDmaPlan {
		chunks,
		bytes_written,
		min_addr,
		max_addr,
	})
}

/// HEX を展開し、記録のある連続区間だけ `write_bytes` する。
pub fn dma_load_intel_hex<F>(
	hex_text: &str,
	mut write_bytes: F,
) -> Result<IntelHexDmaPlan, IntelHexError>
where
	F: FnMut(u32, &[u8]) -> Result<(), IntelHexError>,
{
	let plan = intel_hex_to_dma_plan(hex_text)?;
	for chunk in &plan.chunks {
		if chunk.data.is_empty() {
			continue;
		}
		write_bytes(chunk.byte_addr, &chunk.data)?;
	}
	Ok(plan)
}

/// ファイルから Intel HEX を読み DMA 展開する。
pub fn dma_load_intel_hex_file<F>(
	path: impl AsRef<std::path::Path>,
	write_bytes: F,
) -> Result<IntelHexDmaPlan, IntelHexError>
where
	F: FnMut(u32, &[u8]) -> Result<(), IntelHexError>,
{
	let text = std::fs::read_to_string(path.as_ref()).map_err(|e| IntelHexError {
		message: e.to_string(),
	})?;
	dma_load_intel_hex(&text, write_bytes)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_tiny_ihx() {
		// バイト 0x0200 に 2 バイト AA BB
		let hex = ":02020000AABB97\n:00000001FF\n";
		let plan = intel_hex_to_dma_plan(hex).expect("plan");
		assert_eq!(plan.bytes_written, 2);
		assert_eq!(plan.min_addr, 0x0200);
		assert_eq!(plan.max_addr, Some(0x0201));
		assert_eq!(plan.chunks.len(), 1);
		assert_eq!(plan.chunks[0].byte_addr, 0x0200);
		assert_eq!(plan.chunks[0].data, vec![0xaa, 0xbb]);
	}

	#[test]
	fn merge_adjacent_records() {
		let hex = ":01000000AA55\n:01000100BB43\n:00000001FF\n";
		let plan = intel_hex_to_dma_plan(hex).expect("plan");
		assert_eq!(plan.chunks.len(), 1);
		assert_eq!(plan.chunks[0].data, vec![0xaa, 0xbb]);
	}

	#[test]
	fn dma_callback_writes() {
		let hex = ":020010001122BB\n:00000001FF\n";
		let mut mem = vec![0u8; 0x20];
		let plan = dma_load_intel_hex(hex, |addr, data| {
			let a = addr as usize;
			mem[a..a + data.len()].copy_from_slice(data);
			Ok(())
		})
		.expect("dma");
		assert_eq!(plan.bytes_written, 2);
		assert_eq!(mem[0x10], 0x11);
		assert_eq!(mem[0x11], 0x22);
	}
}
