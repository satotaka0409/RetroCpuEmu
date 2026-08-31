//! TMS9995 が使うメモリバス抽象と RAM 実装。

/// TMS9995 コアがメモリへアクセスするための最小バス I/F。
pub trait Tms9995Bus {
	/// 1 バイト読み取り。
	fn read_byte(&self, addr: u16) -> u8;
	/// 1 バイト書き込み。
	fn write_byte(&mut self, addr: u16, value: u8);

	/// 16bit 語をビッグエンディアン順で読み取る。
	fn read_word(&self, addr: u16) -> u16 {
		let a = addr & 0xfffe;
		let hi = self.read_byte(a) as u16;
		let lo = self.read_byte(a.wrapping_add(1)) as u16;
		(hi << 8) | lo
	}

	/// 16bit 語をビッグエンディアン順で書き込む。
	fn write_word(&mut self, addr: u16, value: u16) {
		let a = addr & 0xfffe;
		self.write_byte(a, (value >> 8) as u8);
		self.write_byte(a.wrapping_add(1), (value & 0x00ff) as u8);
	}
}

/// 単純な RAM バッキングの `Tms9995Bus` 実装。
#[derive(Debug, Clone)]
pub struct Tms9995Ram {
	bytes: Vec<u8>,
}

impl Tms9995Ram {
	/// 指定バイト長の RAM を 0 初期化で生成する。
	///
	/// # Arguments
	/// - `size_bytes`: 関数に渡す値
	/// - `random`: true ならランダム初期化、false ならゼロ初期化
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new(size_bytes: usize, random: bool) -> Self {
		if random {
			let mut seed: u32 = 0x6d2b79f5;
			Self {
				bytes: (0..size_bytes)
					.map(|_| {
						seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
						(seed >> 16) as u8
					})
					.collect(),
			}
		} else {
			Self {
				bytes: vec![0; size_bytes],
			}
		}
	}

	/// RAM の総バイト数。
	///
	/// # Returns
	/// - 件数または長さを返します。
	pub fn len_bytes(&self) -> usize {
		self.bytes.len()
	}

	/// 生バイト列を指定アドレスへ順次ロードする。
	///
	/// # Arguments
	/// - `start_addr`: 開始アドレス
	/// - `data`: データ列
	pub fn load_bytes(&mut self, start_addr: u16, data: &[u8]) {
		let start = usize::from(start_addr);
		for (i, b) in data.iter().enumerate() {
			let idx = start + i;
			if idx < self.bytes.len() {
				self.bytes[idx] = *b;
			}
		}
	}

	/// 16bit 語列をビッグエンディアンとして連続配置する。
	///
	/// # Arguments
	/// - `start_addr`: 開始アドレス
	/// - `data`: データ列
	pub fn load_words_be(&mut self, start_addr: u16, data: &[u16]) {
		let mut addr = start_addr & 0xfffe;
		for w in data {
			self.write_word(addr, *w);
			addr = addr.wrapping_add(2);
		}
	}
}

impl Tms9995Bus for Tms9995Ram {
	fn read_byte(&self, addr: u16) -> u8 {
		self.bytes.get(usize::from(addr)).copied().unwrap_or(0)
	}

	fn write_byte(&mut self, addr: u16, value: u8) {
		if let Some(slot) = self.bytes.get_mut(usize::from(addr)) {
			*slot = value;
		}
	}
}
