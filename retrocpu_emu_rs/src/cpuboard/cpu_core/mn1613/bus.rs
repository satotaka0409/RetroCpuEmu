pub trait Mn1613Bus {
	fn read_word(&self, addr: u16) -> u16;
	fn write_word(&mut self, addr: u16, value: u16);
}

#[derive(Debug, Clone)]
pub struct Mn1613Ram {
	words: Vec<u16>,
}

impl Mn1613Ram {
	pub fn new(size_words: usize) -> Self {
		Self {
			words: vec![0; size_words],
		}
	}

	pub fn load_words(&mut self, start_addr: u16, data: &[u16]) {
		let start = usize::from(start_addr);
		for (i, w) in data.iter().enumerate() {
			let idx = start + i;
			if idx < self.words.len() {
				self.words[idx] = *w;
			}
		}
	}

	pub fn len_words(&self) -> usize {
		self.words.len()
	}
}

impl Mn1613Bus for Mn1613Ram {
	fn read_word(&self, addr: u16) -> u16 {
		self.words.get(usize::from(addr)).copied().unwrap_or(0)
	}

	fn write_word(&mut self, addr: u16, value: u16) {
		if let Some(slot) = self.words.get_mut(usize::from(addr)) {
			*slot = value;
		}
	}
}
