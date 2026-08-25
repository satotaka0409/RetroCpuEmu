pub trait Tms9995Bus {
	fn read_byte(&self, addr: u16) -> u8;
	fn write_byte(&mut self, addr: u16, value: u8);

	fn read_word(&self, addr: u16) -> u16 {
		let a = addr & 0xfffe;
		let hi = self.read_byte(a) as u16;
		let lo = self.read_byte(a.wrapping_add(1)) as u16;
		(hi << 8) | lo
	}

	fn write_word(&mut self, addr: u16, value: u16) {
		let a = addr & 0xfffe;
		self.write_byte(a, (value >> 8) as u8);
		self.write_byte(a.wrapping_add(1), (value & 0x00ff) as u8);
	}
}

#[derive(Debug, Clone)]
pub struct Tms9995Ram {
	bytes: Vec<u8>,
}

impl Tms9995Ram {
	pub fn new(size_bytes: usize) -> Self {
		Self {
			bytes: vec![0; size_bytes],
		}
	}

	pub fn len_bytes(&self) -> usize {
		self.bytes.len()
	}

	pub fn load_bytes(&mut self, start_addr: u16, data: &[u8]) {
		let start = usize::from(start_addr);
		for (i, b) in data.iter().enumerate() {
			let idx = start + i;
			if idx < self.bytes.len() {
				self.bytes[idx] = *b;
			}
		}
	}

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
