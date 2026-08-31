//! MN1613 物理メモリ（256K ワード / 18bit）。

/// フル物理空間のワード数（256K）。
pub const MEM_WORDS: usize = 0x40000;

/// 物理ワードアドレスのマスク（18bit）。
pub const PHYS_MASK: u32 = 0x3ffff;

/// 論理アドレスとセグメントから 18bit 物理ワードアドレスを求める。
///
/// `phys = ((seg & 0xF) << 14) + log`（桁上がり無視）。
///
/// # Arguments
/// - `log`: 論理ワードアドレス（16bit）
/// - `seg`: セグメントレジスタ値（下位 4bit）
///
/// # Returns
/// - 18bit 物理ワードアドレス
#[inline]
pub fn phys(log: u16, seg: u8) -> u32 {
	((((seg as u32) & 0xf) << 14).wrapping_add(log as u32)) & PHYS_MASK
}

/// MN1613 物理 RAM（ワード配列。論理上はビッグエンディアン語）。
#[derive(Clone)]
pub struct Mn1613Ram {
	words: Vec<u16>,
}

impl std::fmt::Debug for Mn1613Ram {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.debug_struct("Mn1613Ram")
			.field("words", &self.words.len())
			.finish()
	}
}

impl Default for Mn1613Ram {
	fn default() -> Self {
		Self::new(true)
	}
}

impl Mn1613Ram {
	/// 256K ワードのゼロ初期化 RAM を作る。
	///
	/// # Arguments
	/// - `randam`: true ならランダム初期化、false ならゼロ初期化
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new(randam: bool) -> Self {
		if randam {
			let mut seed: u32 = 0x6d2b79f5;
			Self {
				words: (0..MEM_WORDS)
					.map(|_| {
						seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
						(seed >> 16) as u16
					})
					.collect(),
			}
		} else {
			Self {
				words: vec![0; MEM_WORDS],
			}
		}
	}

	/// 指定ワード数で作る（テスト用。通常は [`Self::new`]）。
	///
	/// # Arguments
	/// - `size_words`: 関数に渡す値
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn with_size(size_words: usize) -> Self {
		Self {
			words: vec![0; size_words.max(1)],
		}
	}

	/// 物理ワードを読む（範囲外は `0xFFFF`）。
	///
	/// # Arguments
	/// - `phys_addr`: 物理ワードアドレス（下位 18bit）
	///
	/// # Returns
	/// - 読み取った 16bit 値（範囲外は `0xFFFF`）
	#[inline]
	pub fn read_phys(&self, phys_addr: u32) -> u16 {
		let p = (phys_addr & PHYS_MASK) as usize;
		self.words.get(p).copied().unwrap_or(0xffff)
	}

	/// 物理ワードを書く（範囲外は無視）。
	///
	/// # Arguments
	/// - `phys_addr`: 物理ワードアドレス（下位 18bit）
	/// - `val`: 16bit 値
	#[inline]
	pub fn write_phys(&mut self, phys_addr: u32, val: u16) {
		let p = (phys_addr & PHYS_MASK) as usize;
		if let Some(slot) = self.words.get_mut(p) {
			*slot = val;
		}
	}

	/// 論理アドレス（CSBR=0）から読む（リセット peek 用。クロックなし）。
	///
	/// # Arguments
	/// - `log_addr`: 関数に渡す値
	///
	/// # Returns
	/// - 16bit 値を返します。
	pub fn peek_word(&self, log_addr: u16) -> u16 {
		self.read_phys(phys(log_addr, 0))
	}

	/// 連続ワードを物理先頭から書き込む。
	///
	/// # Arguments
	/// - `start_phys`: 開始物理アドレス
	/// - `data`: データ列
	pub fn load_words(&mut self, start_phys: u32, data: &[u16]) {
		for (i, w) in data.iter().enumerate() {
			self.write_phys(start_phys.wrapping_add(i as u32), *w);
		}
	}

	/// ワード数を返す。
	///
	/// # Returns
	/// - 件数または長さを返します。
	pub fn len_words(&self) -> usize {
		self.words.len()
	}

	/// 生スライスへの参照。
	///
	/// # Returns
	/// - 内部ワード配列への読み取り専用参照を返します。
	pub fn as_slice(&self) -> &[u16] {
		&self.words
	}

	/// 生スライスへの可変参照。
	///
	/// # Returns
	/// - 内部ワード配列への可変参照を返します。
	pub fn as_mut_slice(&mut self) -> &mut [u16] {
		&mut self.words
	}

	/// バイト列をビッグエンディアン語として物理バイトアドレスへ DMA 書き込みする。
	///
	/// 奇数先頭／奇数長は既存ワードの片方ニブルを保持する。
	///
	/// * `byte_addr` — 物理バイトアドレス（ワード×2）
	/// * `data` — 書き込むバイト列
	///
	/// # Arguments
	/// - `byte_addr`: バイトアドレス
	/// - `data`: データ列
	pub fn dma_write_bytes(&mut self, byte_addr: u32, data: &[u8]) {
		let mut ba = byte_addr;
		let mut i = 0usize;
		while i < data.len() {
			let word_idx = (ba / 2) & PHYS_MASK;
			if ba % 2 == 0 {
				if i + 1 < data.len() {
					let w = ((data[i] as u16) << 8) | (data[i + 1] as u16);
					self.write_phys(word_idx, w);
					i += 2;
					ba = ba.wrapping_add(2);
				} else {
					let old = self.read_phys(word_idx);
					self.write_phys(word_idx, ((data[i] as u16) << 8) | (old & 0x00ff));
					i += 1;
					ba = ba.wrapping_add(1);
				}
			} else {
				let old = self.read_phys(word_idx);
				self.write_phys(word_idx, (old & 0xff00) | (data[i] as u16));
				i += 1;
				ba = ba.wrapping_add(1);
			}
		}
	}

	/// 物理ワードアドレスからバイト列をビッグエンディアンで DMA 書き込みする。
	///
	/// * `word_addr` — 物理ワードアドレス
	/// * `data` — バイト列（BE で語に詰める）
	///
	/// # Arguments
	/// - `word_addr`: ワードアドレス
	/// - `data`: データ列
	pub fn dma_write_bytes_at_word(&mut self, word_addr: u32, data: &[u8]) {
		self.dma_write_bytes((word_addr & PHYS_MASK) * 2, data);
	}
}
