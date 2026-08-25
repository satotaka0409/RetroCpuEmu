use super::bus::Tms9995Bus;
use super::cru::Tms9995Cru;
use super::error::Tms9995Error;

pub const ST_LGT: u16 = 0x8000;
pub const ST_AGT: u16 = 0x4000;
pub const ST_EQ: u16 = 0x2000;
pub const ST_C: u16 = 0x1000;
pub const ST_OV: u16 = 0x0800;
pub const ST_OP: u16 = 0x0400;
pub const ST_X: u16 = 0x0200;
pub const ST_IMASK: u16 = 0x000f;

const CRU_HSHK_OUT_DATA: u16 = 0x0023;
const CRU_HSHK_IN_DATA: u16 = 0x0027;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tms9995State {
	pub pc: u16,
	pub wp: u16,
	pub st: u16,
	pub idle: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepResult {
	Running,
	Idle,
}

#[derive(Debug, Clone)]
pub struct Tms9995Core {
	state: Tms9995State,
}

#[derive(Debug, Clone, Copy)]
enum Ea {
	Reg(usize),
	Mem(u16),
}

impl Default for Tms9995Core {
	fn default() -> Self {
		Self::new()
	}
}

impl Tms9995Core {
	pub fn new() -> Self {
		Self {
			state: Tms9995State::default(),
		}
	}

	pub fn state(&self) -> Tms9995State {
		self.state
	}

	pub fn set_state(&mut self, state: Tms9995State) {
		self.state = state;
	}

	pub fn reset_from_vector<B: Tms9995Bus>(&mut self, bus: &B) {
		self.state.wp = bus.read_word(0x0000) & 0xfffe;
		self.state.pc = bus.read_word(0x0002) & 0xfffe;
		self.state.st = 0;
		self.state.idle = false;
	}

	pub fn run<B: Tms9995Bus, C: Tms9995Cru>(
		&mut self,
		bus: &mut B,
		cru: &mut C,
		max_cycles: usize,
	) -> Result<usize, Tms9995Error> {
		for cycles in 1..=max_cycles {
			let state = self.step(bus, cru)?;
			if state == StepResult::Idle {
				return Ok(cycles);
			}
		}
		Err(Tms9995Error::MaxCyclesReached { cycles: max_cycles })
	}

	pub fn step<B: Tms9995Bus, C: Tms9995Cru>(
		&mut self,
		bus: &mut B,
		cru: &mut C,
	) -> Result<StepResult, Tms9995Error> {
		if self.state.idle {
			return Ok(StepResult::Idle);
		}

		let old_pc = self.state.pc;
		let ir = self.fetch_word(bus);

		if (ir & 0xff00) == 0x0200 {
			let r = usize::from(ir & 0x000f);
			let imm = self.fetch_word(bus);
			match ir & 0x00f0 {
				0x0000 => {
					self.write_reg(bus, r, imm);
					self.set_lae_word(imm);
				}
				0x0020 => {
					let old = self.read_reg(bus, r);
					let (res, carry, ov) = add_u16(old, imm);
					self.write_reg(bus, r, res);
					self.state.st = set_flag(self.state.st, ST_C, carry);
					self.state.st = set_flag(self.state.st, ST_OV, ov);
					self.set_lae_word(res);
				}
				0x0080 => {
					let a = self.read_reg(bus, r);
					self.set_compare_word(a, imm);
				}
				0x00a0 => {
					self.write_reg(bus, r, self.state.wp);
				}
				0x00c0 => {
					self.write_reg(bus, r, self.state.st);
				}
				0x00e0 => {
					self.state.wp = imm & 0xfffe;
				}
				_ => {
					return Err(Tms9995Error::IllegalInstruction { pc: old_pc, ir });
				}
			}
			return Ok(StepResult::Running);
		}

		match ir {
			0x0300 => {
				let imm = self.fetch_word(bus);
				self.state.st = (self.state.st & !ST_IMASK) | (imm & ST_IMASK);
				return Ok(StepResult::Running);
			}
			0x0340 => {
				self.state.idle = true;
				return Ok(StepResult::Idle);
			}
			0x0360 => {
				self.state.st &= !ST_IMASK;
				return Ok(StepResult::Running);
			}
			0x0380 => {
				let st = self.read_reg(bus, 15);
				let pc = self.read_reg(bus, 14) & 0xfffe;
				let wp = self.read_reg(bus, 13) & 0xfffe;
				self.state.st = st;
				self.state.pc = pc;
				self.state.wp = wp;
				return Ok(StepResult::Running);
			}
			_ => {}
		}

		if (ir & 0xf000) == 0x1000 {
			let sub = ((ir >> 8) & 0x000f) as u8;
			if (0x0d..=0x0f).contains(&sub) {
				let addr = self.cru_addr(bus, (ir & 0x00ff) as u8);
				match sub {
					0x0d => cru.write_bit(addr, true),
					0x0e => cru.write_bit(addr, false),
					0x0f => {
						let bit = cru.read_bit(addr);
						self.state.st = set_flag(self.state.st, ST_EQ, bit);
					}
					_ => {}
				}
				return Ok(StepResult::Running);
			}

			if self.test_condition((ir & 0x0f00) as u16) {
				let disp = sign_i8((ir & 0x00ff) as u8) as i16;
				let next = (i32::from(self.state.pc) + i32::from(disp) * 2) & 0xffff;
				self.state.pc = next as u16;
			}
			return Ok(StepResult::Running);
		}

		if (ir & 0xfc00) == 0x3000 || (ir & 0xfc00) == 0x3400 {
			let is_stcr = (ir & 0xfc00) == 0x3400;
			self.cru_transfer(bus, cru, ir, is_stcr);
			return Ok(StepResult::Running);
		}

		Err(Tms9995Error::IllegalInstruction { pc: old_pc, ir })
	}

	fn fetch_word<B: Tms9995Bus>(&mut self, bus: &B) -> u16 {
		let w = bus.read_word(self.state.pc);
		self.state.pc = self.state.pc.wrapping_add(2);
		w
	}

	fn read_reg<B: Tms9995Bus>(&self, bus: &B, n: usize) -> u16 {
		let addr = self.state.wp.wrapping_add((n as u16) * 2);
		bus.read_word(addr)
	}

	fn write_reg<B: Tms9995Bus>(&self, bus: &mut B, n: usize, value: u16) {
		let addr = self.state.wp.wrapping_add((n as u16) * 2);
		bus.write_word(addr, value);
	}

	fn set_lae_word(&mut self, v: u16) {
		let lgt = v != 0;
		let agt = (v & 0x8000) == 0 && v != 0;
		let eq = v == 0;
		self.state.st = set_flag(self.state.st, ST_LGT, lgt);
		self.state.st = set_flag(self.state.st, ST_AGT, agt);
		self.state.st = set_flag(self.state.st, ST_EQ, eq);
	}

	fn set_lae_byte(&mut self, v: u8) {
		let lgt = v != 0;
		let agt = (v & 0x80) == 0 && v != 0;
		let eq = v == 0;
		self.state.st = set_flag(self.state.st, ST_LGT, lgt);
		self.state.st = set_flag(self.state.st, ST_AGT, agt);
		self.state.st = set_flag(self.state.st, ST_EQ, eq);
	}

	fn set_compare_word(&mut self, a: u16, b: u16) {
		self.state.st = set_flag(self.state.st, ST_EQ, a == b);
		self.state.st = set_flag(self.state.st, ST_LGT, a > b);
		let sa = a as i16;
		let sb = b as i16;
		self.state.st = set_flag(self.state.st, ST_AGT, sa > sb);
	}

	/// `cond_field` の上位 4 ビットが条件コードを表す。
	/// `cond_field` の下位 8 ビットは無視される。
	/// returns true if the condition is satisfied, false otherwise.
	fn test_condition(&self, cond_field: u16) -> bool {
		let c = ((cond_field >> 8) & 0x000f) as u8;
		let st = self.state.st;
		let lgt = (st & ST_LGT) != 0;
		let agt = (st & ST_AGT) != 0;
		let eq = (st & ST_EQ) != 0;
		let carry = (st & ST_C) != 0;
		let ov = (st & ST_OV) != 0;
		let op = (st & ST_OP) != 0;

		match c {
			0x0 => true,
			0x2 => !agt && !eq,
			0x3 => !lgt || eq,
			0x4 => eq,
			0x5 => lgt || eq,
			0x6 => agt,
			0x7 => !eq,
			0x8 => !carry,
			0x9 => carry,
			0xA => !ov,
			0xB => !lgt && !eq,
			0xC => lgt && !eq,
			0xD => op,
			_ => false,
		}
	}

	fn cru_addr<B: Tms9995Bus>(&self, bus: &B, disp8: u8) -> u16 {
		let base = self.read_reg(bus, 12);
		base.wrapping_add(sign_i8(disp8) as u16)
	}

	fn resolve_ea<B: Tms9995Bus>(&mut self, bus: &mut B, mode: u16, reg: usize, byte_op: bool) -> Ea {
		match mode & 0x0003 {
			0 => Ea::Reg(reg & 0x0f),
			1 => {
				let addr = self.read_reg(bus, reg & 0x0f);
				Ea::Mem(addr)
			}
			2 => {
				let off = self.fetch_word(bus);
				if (reg & 0x0f) == 0 {
					Ea::Mem(off)
				} else {
					let base = self.read_reg(bus, reg & 0x0f);
					Ea::Mem(base.wrapping_add(off))
				}
			}
			3 => {
				let r = reg & 0x0f;
				let addr = self.read_reg(bus, r);
				let inc = if byte_op { 1 } else { 2 };
				self.write_reg(bus, r, addr.wrapping_add(inc));
				Ea::Mem(addr)
			}
			_ => Ea::Reg(0),
		}
	}

	fn read_word_ea<B: Tms9995Bus>(&self, bus: &B, ea: Ea) -> u16 {
		match ea {
			Ea::Reg(n) => self.read_reg(bus, n),
			Ea::Mem(addr) => bus.read_word(addr),
		}
	}

	fn write_word_ea<B: Tms9995Bus>(&self, bus: &mut B, ea: Ea, value: u16) {
		match ea {
			Ea::Reg(n) => self.write_reg(bus, n, value),
			Ea::Mem(addr) => bus.write_word(addr, value),
		}
	}

	fn read_byte_ea<B: Tms9995Bus>(&self, bus: &B, ea: Ea) -> u8 {
		match ea {
			Ea::Reg(n) => (self.read_reg(bus, n) & 0x00ff) as u8,
			Ea::Mem(addr) => bus.read_byte(addr),
		}
	}

	fn write_byte_ea<B: Tms9995Bus>(&self, bus: &mut B, ea: Ea, value: u8) {
		match ea {
			Ea::Reg(n) => {
				let old = self.read_reg(bus, n);
				let next = (old & 0xff00) | u16::from(value);
				self.write_reg(bus, n, next);
			}
			Ea::Mem(addr) => bus.write_byte(addr, value),
		}
	}

	fn cru_transfer<B: Tms9995Bus, C: Tms9995Cru>(
		&mut self,
		bus: &mut B,
		cru: &mut C,
		ir: u16,
		is_stcr: bool,
	) {
		let mut bits = ((ir >> 6) & 0x000f) as usize;
		if bits == 0 {
			bits = 16;
		}
		let mode = (ir >> 4) & 0x0003;
		let reg = usize::from(ir & 0x000f);
		let ea = self.resolve_ea(bus, mode, reg, bits <= 8);
		let base = self.read_reg(bus, 12);

		if is_stcr {
			if base == CRU_HSHK_IN_DATA && bits == 8 {
				let b = cru.read_data_byte();
				self.write_byte_ea(bus, ea, b);
				self.set_lae_byte(b);
				return;
			}
			if bits <= 8 {
				let mut b = 0u8;
				for i in 0..bits {
					if cru.read_bit(base.wrapping_add(i as u16)) {
						b |= 1u8 << i;
					}
				}
				self.write_byte_ea(bus, ea, b);
				self.set_lae_byte(b);
			} else {
				let mut w = 0u16;
				for i in 0..16 {
					if cru.read_bit(base.wrapping_add(i as u16)) {
						w |= 1u16 << i;
					}
				}
				self.write_word_ea(bus, ea, w);
				self.set_lae_word(w);
			}
			return;
		}

		if base == CRU_HSHK_OUT_DATA && bits == 8 {
			let b = self.read_byte_ea(bus, ea);
			cru.write_data_byte(b);
			return;
		}
		if bits <= 8 {
			let b = self.read_byte_ea(bus, ea);
			for i in 0..bits {
				let bit = ((b >> i) & 1) != 0;
				cru.write_bit(base.wrapping_add(i as u16), bit);
			}
		} else {
			let w = self.read_word_ea(bus, ea);
			for i in 0..16 {
				let bit = ((w >> i) & 1) != 0;
				cru.write_bit(base.wrapping_add(i as u16), bit);
			}
		}
	}
}

fn sign_i8(v: u8) -> i8 {
	v as i8
}

fn set_flag(st: u16, mask: u16, enabled: bool) -> u16 {
	if enabled {
		st | mask
	} else {
		st & !mask
	}
}

fn add_u16(a: u16, b: u16) -> (u16, bool, bool) {
	let (r, carry) = a.overflowing_add(b);
	let sa = (a & 0x8000) != 0;
	let sb = (b & 0x8000) != 0;
	let sr = (r & 0x8000) != 0;
	let ov = (sa == sb) && (sa != sr);
	(r, carry, ov)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::cpu_core::tms9995::{Tms9995CruBus, Tms9995Ram};

	#[test]
	fn cru_single_bit_ops_use_r12_base_with_signed_disp() {
		let mut bus = Tms9995Ram::new(0x10000);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0100u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x0200);
		cpu.reset_from_vector(&bus);
		bus.write_word(wp + 24, 0x0010);

		bus.load_words_be(0x0200, &[0x1d02, 0x1f02, 0x1e02, 0x1ffe, 0x0340]);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert!(cru.input_bit(0x0012));
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_ne!(cpu.state().st & ST_EQ, 0);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert!(!cru.input_bit(0x0012));

		cru.set_input_bit(0x000e, true);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_ne!(cpu.state().st & ST_EQ, 0);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Idle));
	}

	#[test]
	fn ldcr_and_stcr_special_data_ports_work() {
		let mut bus = Tms9995Ram::new(0x10000);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0200u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x0400);
		cpu.reset_from_vector(&bus);
		bus.write_word(wp + 24, CRU_HSHK_OUT_DATA);
		bus.write_word(wp + 2, 0x00a5);
		bus.write_word(wp + 4, 0x0600);

		cru.set_input_data(0x5a);
		bus.load_words_be(0x0400, &[0x3201, 0x3602, 0x0340]);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(cru.output_data(), 0xa5);

		bus.write_word(wp + 24, CRU_HSHK_IN_DATA);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 4), 0x065a);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Idle));
	}

	#[test]
	fn stcr_builds_byte_from_cru_bits_lsb_first() {
		let mut bus = Tms9995Ram::new(0x10000);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0300u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x0800);
		cpu.reset_from_vector(&bus);
		bus.write_word(wp + 24, 0x0100);
		bus.write_word(wp + 6, 0x0000);

		for (i, bit) in [true, false, true, true, false, true, false, false]
			.iter()
			.enumerate()
		{
			cru.set_input_bit(0x0100 + i as u16, *bit);
		}

		bus.load_words_be(0x0800, &[0x3603, 0x0340]);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 6), 0x002d);
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Idle));
	}
}
