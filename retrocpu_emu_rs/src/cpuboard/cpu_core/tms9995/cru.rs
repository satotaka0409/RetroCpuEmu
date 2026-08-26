use std::collections::BTreeMap;

pub trait Tms9995Cru {
	fn read_bit(&self, addr: u16) -> bool;
	fn write_bit(&mut self, addr: u16, value: bool);

	fn read_data_byte(&self) -> u8 {
		let mut b = 0u8;
		for i in 0..8 {
			if self.read_bit(i) {
				b |= 1u8 << i;
			}
		}
		b
	}

	fn write_data_byte(&mut self, value: u8) {
		for i in 0..8 {
			self.write_bit(i, ((value >> i) & 1) != 0);
		}
	}
}

#[derive(Debug, Clone, Default)]
pub struct Tms9995CruBus {
	bits: BTreeMap<u16, bool>,
	in_data: u8,
	out_data: u8,
}

impl Tms9995CruBus {
	pub fn set_input_bit(&mut self, addr: u16, value: bool) {
		self.bits.insert(addr, value);
	}

	pub fn input_bit(&self, addr: u16) -> bool {
		self.bits.get(&addr).copied().unwrap_or(false)
	}

	pub fn set_input_data(&mut self, value: u8) {
		self.in_data = value;
	}

	pub fn output_data(&self) -> u8 {
		self.out_data
	}
}

impl Tms9995Cru for Tms9995CruBus {
	fn read_bit(&self, addr: u16) -> bool {
		self.bits.get(&addr).copied().unwrap_or(false)
	}

	fn write_bit(&mut self, addr: u16, value: bool) {
		self.bits.insert(addr, value);
	}

	fn read_data_byte(&self) -> u8 {
		self.in_data
	}

	fn write_data_byte(&mut self, value: u8) {
		self.out_data = value;
	}
}
