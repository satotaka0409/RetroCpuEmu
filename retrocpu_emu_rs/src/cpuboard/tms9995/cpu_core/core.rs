//! TMS9995 CPU コア本体。

use super::bus::Tms9995Bus;
use super::cru::Tms9995Cru;
use super::error::Tms9995Error;

/// Status レジスタ: Logical Greater Than。
pub const ST_LGT: u16 = 0x8000;
/// Status レジスタ: Arithmetic Greater Than。
pub const ST_AGT: u16 = 0x4000;
/// Status レジスタ: Equal。
pub const ST_EQ: u16 = 0x2000;
/// Status レジスタ: Carry。
pub const ST_C: u16 = 0x1000;
/// Status レジスタ: Overflow。
pub const ST_OV: u16 = 0x0800;
/// Status レジスタ: Odd Parity。
pub const ST_OP: u16 = 0x0400;
/// Status レジスタ: XOP 実行中フラグ。
pub const ST_X: u16 = 0x0200;
/// Status レジスタ: 割り込みマスク（下位 4bit）。
pub const ST_IMASK: u16 = 0x000f;

const CRU_HSHK_OUT_DATA: u16 = 0x0023;
const CRU_HSHK_IN_DATA: u16 = 0x0027;

/// TMS9995 の主要レジスタ状態。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Tms9995State {
	/// Program Counter（偶数境界）。
	pub pc: u16,
	/// Workspace Pointer（レジスタバンク先頭）。
	pub wp: u16,
	/// Status レジスタ。
	pub st: u16,
	/// `IDLE` 命令で停止中なら true。
	pub idle: bool,
}

/// 1 ステップ実行後のコア状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepResult {
	/// 実行継続可能。
	Running,
	/// IDLE 状態へ遷移。
	Idle,
}

/// TMS9995 CPU コア本体。
#[derive(Debug, Clone)]
pub struct Tms9995Core {
	state: Tms9995State,
}

#[derive(Debug, Clone, Copy)]
enum Ea {
	Reg(usize),
	Mem(u16),
}

#[derive(Debug, Clone, Copy)]
enum Format1Op {
	Add,
	Sub,
	Cmp,
	Mov,
	Soc,
	Szc,
}

impl Default for Tms9995Core {
	fn default() -> Self {
		Self::new()
	}
}

impl Tms9995Core {
	/// リセット直後相当の状態でコアを作る。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			state: Tms9995State::default(),
		}
	}

	/// 現在の CPU 状態をコピーで取得する。
	///
	/// # Returns
	/// - 現在の CPU 状態スナップショットを返します。
	pub fn state(&self) -> Tms9995State {
		self.state
	}

	/// デバッグや復元用に CPU 状態を丸ごと上書きする。
	///
	/// # Arguments
	/// - `state`: CPU 状態
	pub fn set_state(&mut self, state: Tms9995State) {
		self.state = state;
	}

	/// メモリ先頭ベクタから `WP` / `PC` を読み取り、実行状態を初期化する。
	///
	/// # Arguments
	/// - `bus`: メモリバス
	pub fn reset_from_vector<B: Tms9995Bus>(&mut self, bus: &B) {
		self.state.wp = bus.read_word(0x0000) & 0xfffe;
		self.state.pc = bus.read_word(0x0002) & 0xfffe;
		self.state.st = 0;
		self.state.idle = false;
	}

	/// 最大 `max_cycles` 命令まで実行し、`IDLE` 到達か上限超過で戻る。
	///
	/// # Arguments
	/// - `bus`: 命令とデータを供給するメモリバス
	/// - `cru`: CRU ビット I/O バス
	/// - `max_cycles`: 実行する最大命令数
	///
	/// # Returns
	/// - `IDLE` に到達するまでに実行した命令数
	///
	/// # Errors
	/// - `Tms9995Error::MaxCyclesReached`: `max_cycles` 以内に停止しなかった場合
	/// - `Tms9995Error::IllegalInstruction`: 実行中に不正命令へ到達した場合
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

	/// 命令 1 個ぶん実行する。
	/// 未実装命令は `IllegalInstruction` を返す。
	///
	/// # Arguments
	/// - `bus`: 命令とデータを供給するメモリバス
	/// - `cru`: CRU ビット I/O バス
	///
	/// # Returns
	/// - 実行後の状態（継続実行中か `IDLE` 到達か）
	///
	/// # Errors
	/// - `Tms9995Error::IllegalInstruction`: 不正命令を検出した場合
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
		self.execute_ir(bus, cru, ir, old_pc)
	}

	fn execute_ir<B: Tms9995Bus, C: Tms9995Cru>(
		&mut self,
		bus: &mut B,
		cru: &mut C,
		ir: u16,
		old_pc: u16,
	) -> Result<StepResult, Tms9995Error> {
		let hi = ir & 0xff00;

		// Format 8 即値系（LI/AI/ANDI/ORI/CI/STWP/STST/LWPI）。中位ニブルが命令種別。
		let op8 = ir & 0xfff0;
		if matches!(
			op8,
			0x0200 | 0x0220 | 0x0240 | 0x0260 | 0x0280 | 0x02a0 | 0x02c0 | 0x02e0
		) {
			let r = usize::from(ir & 0x000f);
			let imm = self.fetch_word(bus);
			match op8 {
				0x0200 => {
					self.write_reg(bus, r, imm);
					self.set_lae_word(imm);
				}
				0x0220 => {
					let old = self.read_reg(bus, r);
					let res = old.wrapping_add(imm);
					self.write_reg(bus, r, res);
					self.state.st = set_add_flags(self.state.st, old, imm, res);
				}
				0x0240 => {
					let old = self.read_reg(bus, r);
					let res = old & imm;
					self.write_reg(bus, r, res);
					self.set_lae_word(res);
				}
				0x0260 => {
					let old = self.read_reg(bus, r);
					let res = old | imm;
					self.write_reg(bus, r, res);
					self.set_lae_word(res);
				}
				0x0280 => {
					let a = self.read_reg(bus, r);
					self.set_compare_word(a, imm);
				}
				0x02a0 => {
					self.write_reg(bus, r, self.state.wp);
				}
				0x02c0 => {
					self.write_reg(bus, r, self.state.st);
				}
				0x02e0 => {
					self.state.wp = imm & 0xfffe;
				}
				_ => {
					return Err(Tms9995Error::IllegalInstruction { pc: old_pc, ir });
				}
			}
			return Ok(StepResult::Running);
		}

		if hi == 0x0080 {
			self.state.st = self.read_reg(bus, usize::from(ir & 0x000f));
			return Ok(StepResult::Running);
		}
		if hi == 0x0090 {
			self.state.wp = self.read_reg(bus, usize::from(ir & 0x000f)) & 0xfffe;
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

		if (ir & 0xf000) == 0x2000 {
			self.format3(bus, ir);
			return Ok(StepResult::Running);
		}

		if (ir & 0xfc00) == 0x3000 || (ir & 0xfc00) == 0x3400 {
			let is_stcr = (ir & 0xfc00) == 0x3400;
			self.cru_transfer(bus, cru, ir, is_stcr);
			return Ok(StepResult::Running);
		}

		if (ir & 0xfc00) >= 0x0800 && (ir & 0xfc00) <= 0x0bff {
			self.shift_op(bus, ir);
			return Ok(StepResult::Running);
		}

		if (ir & 0xfc00) == 0x3800 {
			let ss = (ir >> 4) & 0x0003;
			let s_reg = usize::from(ir & 0x000f);
			let src = self.resolve_ea(bus, ss, s_reg, false);
			let s = self.read_word_ea(bus, src);
			let r0 = self.read_reg(bus, 0);
			let prod = u32::from(r0) * u32::from(s);
			self.write_reg(bus, 0, (prod >> 16) as u16);
			self.write_reg(bus, 1, prod as u16);
			return Ok(StepResult::Running);
		}
		if (ir & 0xfc00) == 0x3c00 {
			let ss = (ir >> 4) & 0x0003;
			let s_reg = usize::from(ir & 0x000f);
			let src = self.resolve_ea(bus, ss, s_reg, false);
			let div = self.read_word_ea(bus, src);
			let hi32 = self.read_reg(bus, 0);
			let lo32 = self.read_reg(bus, 1);
			if div_overflow(hi32, lo32, div) {
				self.state.st |= ST_OV;
				return Ok(StepResult::Running);
			}
			let dividend = (u32::from(hi32) << 16) | u32::from(lo32);
			let q = (dividend / u32::from(div)) as u16;
			let rem = (dividend % u32::from(div)) as u16;
			self.state.st &= !ST_OV;
			self.write_reg(bus, 0, q);
			self.write_reg(bus, 1, rem);
			return Ok(StepResult::Running);
		}
		if (ir & 0xf800) == 0x2c00 {
			let ss = (ir >> 4) & 0x0003;
			let s_reg = usize::from(ir & 0x000f);
			let src = self.resolve_ea(bus, ss, s_reg, false);
			let r11 = ea_addr(src, self.state.wp);
			let xop = (ir >> 6) & 0x000f;
			self.state.st |= ST_X;
			self.do_blwp(bus, 0x0040 + xop * 4, Some(r11));
			return Ok(StepResult::Running);
		}

		// Format I: 上位 4bit が命令族（第2ニブルは Td/D を含むため ff00 では足りない）
		let op4 = ir & 0xf000;
		if op4 == 0xa000 {
			self.format1(bus, ir, false, Format1Op::Add);
			return Ok(StepResult::Running);
		}
		if op4 == 0xb000 {
			self.format1(bus, ir, true, Format1Op::Add);
			return Ok(StepResult::Running);
		}
		if op4 == 0x6000 {
			self.format1(bus, ir, false, Format1Op::Sub);
			return Ok(StepResult::Running);
		}
		if op4 == 0x7000 {
			self.format1(bus, ir, true, Format1Op::Sub);
			return Ok(StepResult::Running);
		}
		if op4 == 0x8000 {
			self.format1(bus, ir, false, Format1Op::Cmp);
			return Ok(StepResult::Running);
		}
		if op4 == 0x9000 {
			self.format1(bus, ir, true, Format1Op::Cmp);
			return Ok(StepResult::Running);
		}
		if op4 == 0xc000 {
			self.format1(bus, ir, false, Format1Op::Mov);
			return Ok(StepResult::Running);
		}
		if op4 == 0xd000 {
			self.format1(bus, ir, true, Format1Op::Mov);
			return Ok(StepResult::Running);
		}
		if op4 == 0xe000 {
			self.format1(bus, ir, false, Format1Op::Soc);
			return Ok(StepResult::Running);
		}
		if op4 == 0xf000 {
			self.format1(bus, ir, true, Format1Op::Soc);
			return Ok(StepResult::Running);
		}
		if op4 == 0x4000 {
			self.format1(bus, ir, false, Format1Op::Szc);
			return Ok(StepResult::Running);
		}
		if op4 == 0x5000 {
			self.format1(bus, ir, true, Format1Op::Szc);
			return Ok(StepResult::Running);
		}

		if hi == 0x0180 {
			let ss = (ir >> 4) & 0x0003;
			let s_reg = usize::from(ir & 0x000f);
			let ea = self.resolve_ea(bus, ss, s_reg, false);
			let div = self.read_word_ea(bus, ea);
			let hi32 = self.read_reg(bus, 0);
			let lo32 = self.read_reg(bus, 1);
			if divs_overflow(hi32, lo32, div) {
				self.state.st |= ST_OV;
				return Ok(StepResult::Running);
			}
			let dividend = ((hi32 as i32) << 16) | (lo32 as u32 as i32);
			let divs = div as i16 as i32;
			let q = (dividend / divs) as i16 as u16;
			let rem = (dividend % divs) as i16 as u16;
			self.state.st &= !ST_OV;
			self.write_reg(bus, 0, q);
			self.write_reg(bus, 1, rem);
			return Ok(StepResult::Running);
		}
		if hi == 0x01c0 {
			let ss = (ir >> 4) & 0x0003;
			let s_reg = usize::from(ir & 0x000f);
			let ea = self.resolve_ea(bus, ss, s_reg, false);
			let v = self.read_word_ea(bus, ea) as i16;
			let r0 = self.read_reg(bus, 0) as i16;
			let prod = i32::from(r0) * i32::from(v);
			self.write_reg(bus, 0, ((prod >> 16) & 0xffff) as u16);
			self.write_reg(bus, 1, (prod & 0xffff) as u16);
			return Ok(StepResult::Running);
		}

		if (ir & 0xc000) == 0x0000 && (ir & 0xfc00) >= 0x0400 && (ir & 0xfc00) < 0x0800 {
			return self.format6(bus, cru, ir, old_pc);
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
		self.state.st = set_flag(self.state.st & !(ST_LGT | ST_AGT | ST_EQ), ST_EQ, a == b);
		self.state.st = set_flag(self.state.st, ST_LGT, a > b);
		let sa = a as i16;
		let sb = b as i16;
		self.state.st = set_flag(self.state.st, ST_AGT, sa > sb);
	}

	/// `cond_field` の上位 4 ビットが条件コードを表す。
	/// `cond_field` の下位 8 ビットは無視される。
	///
	/// # Returns
	/// - 条件成立時は `true`、不成立時は `false`。
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
			// Format 2: COND は命令ビット 11–8（JMP=0 … JOP=0xC）。根拠: TMS9995_instruction.mdc
			0x0 => true,            // JMP
			0x1 => !agt && !eq,     // JLT
			0x2 => !lgt || eq,      // JLE
			0x3 => eq,              // JEQ
			0x4 => lgt || eq,       // JHE
			0x5 => agt,             // JGT
			0x6 => !eq,             // JNE
			0x7 => !carry,          // JNC
			0x8 => carry,           // JOC
			0x9 => !ov,             // JNO
			0xA => !lgt && !eq,     // JL
			0xB => lgt && !eq,      // JH
			0xC => op,              // JOP
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

	fn ea_address(&self, ea: Ea) -> u16 {
		match ea {
			Ea::Reg(n) => self.state.wp.wrapping_add(((n & 0x0f) as u16) * 2),
			Ea::Mem(addr) => addr,
		}
	}

	/// B / BL / BLWP の分岐先（レジスタモードはレジスタ値、それ以外は実効アドレス）。
	fn branch_target<B: Tms9995Bus>(&self, bus: &B, ea: Ea) -> u16 {
		match ea {
			Ea::Reg(n) => self.read_reg(bus, n),
			Ea::Mem(addr) => addr,
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

	fn do_blwp<B: Tms9995Bus>(&mut self, bus: &mut B, vector_byte_addr: u16, r11: Option<u16>) {
		let new_wp = bus.read_word(vector_byte_addr) & 0xfffe;
		let new_pc = bus.read_word(vector_byte_addr.wrapping_add(2)) & 0xfffe;
		bus.write_word(new_wp.wrapping_add(13 * 2), self.state.wp);
		bus.write_word(new_wp.wrapping_add(14 * 2), self.state.pc);
		bus.write_word(new_wp.wrapping_add(15 * 2), self.state.st);
		if let Some(v) = r11 {
			bus.write_word(new_wp.wrapping_add(11 * 2), v);
		}
		self.state.wp = new_wp;
		self.state.pc = new_pc;
		self.state.idle = false;
	}

	fn format1<B: Tms9995Bus>(&mut self, bus: &mut B, ir: u16, byte_op: bool, op: Format1Op) {
		let dd = (ir >> 10) & 0x0003;
		let ss = (ir >> 4) & 0x0003;
		let d_reg = usize::from((ir >> 6) & 0x000f);
		let s_reg = usize::from(ir & 0x000f);
		let dst = self.resolve_ea(bus, dd, d_reg, byte_op);
		let src = self.resolve_ea(bus, ss, s_reg, byte_op);

		if byte_op {
			let d = self.read_byte_ea(bus, dst);
			let s = self.read_byte_ea(bus, src);
			match op {
				Format1Op::Add => {
					let r = d.wrapping_add(s);
					self.state.st = set_add_flags_byte(self.state.st, d, s, r);
					self.write_byte_ea(bus, dst, r);
				}
				Format1Op::Sub => {
					let r = d.wrapping_sub(s);
					self.state.st = set_sub_flags_byte(self.state.st, d, s, r);
					self.write_byte_ea(bus, dst, r);
				}
				Format1Op::Soc => {
					let r = d | s;
					self.set_lae_byte(r);
					self.write_byte_ea(bus, dst, r);
				}
				Format1Op::Szc => {
					let r = d & !s;
					self.set_lae_byte(r);
					self.write_byte_ea(bus, dst, r);
				}
				Format1Op::Cmp => {
					// CB: L> は src > dst
					self.state.st = set_compare_byte(self.state.st, s, d);
				}
				Format1Op::Mov => {
					self.set_lae_byte(s);
					self.write_byte_ea(bus, dst, s);
				}
			}
			return;
		}

		let d = self.read_word_ea(bus, dst);
		let s = self.read_word_ea(bus, src);
		match op {
			Format1Op::Add => {
				let r = d.wrapping_add(s);
				self.state.st = set_add_flags(self.state.st, d, s, r);
				self.write_word_ea(bus, dst, r);
			}
			Format1Op::Sub => {
				let r = d.wrapping_sub(s);
				self.state.st = set_sub_flags(self.state.st, d, s, r);
				self.write_word_ea(bus, dst, r);
			}
			Format1Op::Soc => {
				let r = d | s;
				self.set_lae_word(r);
				self.write_word_ea(bus, dst, r);
			}
			Format1Op::Szc => {
				let r = d & !s;
				self.set_lae_word(r);
				self.write_word_ea(bus, dst, r);
			}
			Format1Op::Cmp => {
				// C/CB: ST は source と destination の比較（L> は src > dst）
				self.set_compare_word(s, d);
			}
			Format1Op::Mov => {
				self.set_lae_word(s);
				self.write_word_ea(bus, dst, s);
			}
		}
	}

	fn format3<B: Tms9995Bus>(&mut self, bus: &mut B, ir: u16) {
		let d_reg = usize::from((ir >> 6) & 0x000f);
		let ss = (ir >> 4) & 0x0003;
		let s_reg = usize::from(ir & 0x000f);
		let dst = Ea::Reg(d_reg);
		let src = self.resolve_ea(bus, ss, s_reg, false);
		let d = self.read_word_ea(bus, dst);
		let s = self.read_word_ea(bus, src);
		if (ir & 0x0c00) == 0x0800 {
			let r = d ^ s;
			self.set_lae_word(r);
			self.write_word_ea(bus, dst, r);
			return;
		}
		let op = (ir >> 11) & 1;
		let masked = if op == 0 {
			(d & s) == s
		} else {
			(d | s) == d
		};
		self.state.st = set_flag(self.state.st, ST_EQ, masked);
	}

	fn shift_op<B: Tms9995Bus>(&mut self, bus: &mut B, ir: u16) {
		let reg = usize::from(ir & 0x000f);
		let mut cnt = ((ir >> 4) & 0x000f) as u32;
		if cnt == 0 {
			cnt = ((self.read_reg(bus, 0) >> 12) & 0x000f) as u32;
			if cnt == 0 {
				cnt = 16;
			}
		}
		let kind = ((ir >> 8) & 0x0003) as u8;
		let mut v = self.read_reg(bus, reg);
		let mut carry = false;
		let mut overflow = false;
		let sign = (v & 0x8000) != 0;
		for _ in 0..cnt {
			match kind {
				0 => {
					carry = (v & 1) != 0;
					v = (v >> 1) | if sign { 0x8000 } else { 0 };
				}
				1 => {
					carry = (v & 1) != 0;
					v >>= 1;
				}
				2 => {
					carry = (v & 0x8000) != 0;
					v = (v << 1) & 0xffff;
					if carry != ((v & 0x8000) != 0) {
						overflow = true;
					}
				}
				3 => {
					carry = (v & 1) != 0;
					v = (v >> 1) | if carry { 0x8000 } else { 0 };
				}
				_ => {}
			}
		}
		self.set_lae_word(v);
		self.state.st = set_flag(self.state.st, ST_C, carry);
		if kind == 2 {
			self.state.st = set_flag(self.state.st, ST_OV, overflow);
		}
		self.write_reg(bus, reg, v);
	}

	fn format6<B: Tms9995Bus, C: Tms9995Cru>(
		&mut self,
		bus: &mut B,
		cru: &mut C,
		ir: u16,
		old_pc: u16,
	) -> Result<StepResult, Tms9995Error> {
		let ss = (ir >> 4) & 0x0003;
		let s_reg = usize::from(ir & 0x000f);
		let ea = self.resolve_ea(bus, ss, s_reg, false);
		let op6 = ir & 0xffc0;

		match op6 {
			0x0400 => {
				// BLWP: Src の実効アドレスがベクタ先頭（中身ではない）
				let vec = self.branch_target(bus, ea) & 0xfffe;
				self.do_blwp(bus, vec, None);
			}
			0x0440 => {
				// B: PC ← 分岐先（レジスタモードは Rn の値）
				self.state.pc = self.branch_target(bus, ea) & 0xfffe;
			}
			0x0480 => {
				// X: 実効アドレス上の命令語を実行する
				let inner = self.read_word_ea(bus, ea);
				self.execute_ir(bus, cru, inner, old_pc)?;
			}
			0x04c0 => {
				self.write_word_ea(bus, ea, 0);
				self.set_lae_word(0);
			}
			0x0500 => {
				let v = self.read_word_ea(bus, ea);
				let r = v.wrapping_neg();
				self.write_word_ea(bus, ea, r);
				self.set_lae_word(r);
			}
			0x0540 => {
				let v = !self.read_word_ea(bus, ea);
				self.write_word_ea(bus, ea, v);
				self.set_lae_word(v);
			}
			0x0580 => {
				let v = self.read_word_ea(bus, ea).wrapping_add(1);
				self.write_word_ea(bus, ea, v);
				self.set_lae_word(v);
			}
			0x05c0 => {
				let v = self.read_word_ea(bus, ea).wrapping_add(2);
				self.write_word_ea(bus, ea, v);
				self.set_lae_word(v);
			}
			0x0600 => {
				let v = self.read_word_ea(bus, ea).wrapping_sub(1);
				self.write_word_ea(bus, ea, v);
				self.set_lae_word(v);
			}
			0x0640 => {
				let v = self.read_word_ea(bus, ea).wrapping_sub(2);
				self.write_word_ea(bus, ea, v);
				self.set_lae_word(v);
			}
			0x0680 => {
				// BL: R11 ← 復帰 PC、PC ← 分岐先（レジスタモードは Rn の値）
				let target = self.branch_target(bus, ea) & 0xfffe;
				self.write_reg(bus, 11, self.state.pc);
				self.state.pc = target;
			}
			0x06c0 => {
				let v = self.read_word_ea(bus, ea);
				let sw = ((v & 0x00ff) << 8) | (v >> 8);
				self.write_word_ea(bus, ea, sw);
				self.set_lae_word(sw);
			}
			0x0700 => {
				self.write_word_ea(bus, ea, 0xffff);
				self.set_lae_word(0xffff);
			}
			0x0740 => {
				let raw = self.read_word_ea(bus, ea);
				self.set_lae_word(raw);
				self.state.st = set_flag(self.state.st, ST_OV, raw == 0x8000);
				self.state.st &= !ST_C;
				let mut v = raw;
				if (v & 0x8000) != 0 {
					v = v.wrapping_neg();
				}
				self.write_word_ea(bus, ea, v);
				self.set_lae_word(v);
			}
			_ => {
				return Err(Tms9995Error::IllegalInstruction { pc: old_pc, ir });
			}
		}
		Ok(StepResult::Running)
	}
}

fn sign_i8(v: u8) -> i8 {
	v as i8
}

fn ea_addr(ea: Ea, wp: u16) -> u16 {
	match ea {
		Ea::Reg(n) => wp.wrapping_add((n as u16) * 2),
		Ea::Mem(addr) => addr,
	}
}

fn set_flag(st: u16, mask: u16, enabled: bool) -> u16 {
	if enabled {
		st | mask
	} else {
		st & !mask
	}
}

fn set_lae_word_flags(st: u16, result: u16) -> u16 {
	let mut out = st & !(ST_LGT | ST_AGT | ST_EQ);
	if result == 0 {
		out |= ST_EQ;
	} else {
		out |= ST_LGT;
		if (result & 0x8000) == 0 {
			out |= ST_AGT;
		}
	}
	out
}

fn set_add_flags(st: u16, a: u16, b: u16, result: u16) -> u16 {
	let sum = u32::from(a) + u32::from(b);
	let mut out = set_lae_word_flags(st, result);
	out = set_flag(out, ST_C, sum > 0xffff);
	let as_ = a as i16;
	let bs = b as i16;
	let rs = result as i16;
	let ov = (as_ > 0 && bs > 0 && rs < 0) || (as_ < 0 && bs < 0 && rs >= 0);
	set_flag(out, ST_OV, ov)
}

fn set_sub_flags(st: u16, a: u16, b: u16, result: u16) -> u16 {
	let mut out = set_lae_word_flags(st, result);
	out = set_flag(out, ST_C, a >= b);
	let as_ = a as i16;
	let bs = b as i16;
	let rs = result as i16;
	let ov = (as_ >= 0 && bs < 0 && rs < 0) || (as_ < 0 && bs >= 0 && rs >= 0);
	set_flag(out, ST_OV, ov)
}

fn set_compare_byte(st: u16, dest: u8, src: u8) -> u16 {
	let mut out = st & !(ST_LGT | ST_AGT | ST_EQ | ST_OP);
	if dest == src {
		out |= ST_EQ;
	}
	if dest > src {
		out |= ST_LGT;
	}
	let ds = dest as i8;
	let ss = src as i8;
	if ds > ss {
		out |= ST_AGT;
	}
	let ones = dest.count_ones();
	if ones & 1 != 0 {
		out |= ST_OP;
	}
	out
}

fn set_lae_byte_flags(st: u16, result: u8) -> u16 {
	let mut out = st & !(ST_LGT | ST_AGT | ST_EQ | ST_OP);
	if result == 0 {
		out |= ST_EQ;
	} else {
		out |= ST_LGT;
		if (result & 0x80) == 0 {
			out |= ST_AGT;
		}
	}
	if result.count_ones() & 1 != 0 {
		out |= ST_OP;
	}
	out
}

fn set_add_flags_byte(st: u16, a: u8, b: u8, result: u8) -> u16 {
	let st = set_add_flags(st, u16::from(a), u16::from(b), u16::from(result));
	set_lae_byte_flags(st, result)
}

fn set_sub_flags_byte(st: u16, a: u8, b: u8, result: u8) -> u16 {
	let st = set_sub_flags(st, u16::from(a), u16::from(b), u16::from(result));
	set_lae_byte_flags(st, result)
}

fn div_overflow(hi: u16, _lo: u16, divisor: u16) -> bool {
	if divisor == 0 {
		return true;
	}
	hi >= divisor
}

fn divs_overflow(w1: u16, w2: u16, divisor: u16) -> bool {
	let divs = divisor as i16 as i32;
	let dividend = ((w1 as i32) << 16) | (w2 as u32 as i32);
	if divs == 0 {
		return true;
	}
	if dividend >= 0 {
		if divs > 0 {
			return dividend > (divs << 15) - 1;
		}
		return dividend > (-divs << 15) + -divs - 1;
	}
	let nd = -dividend;
	if divs > 0 {
		return nd > (divs << 15) + divs - 1;
	}
	nd > (-divs << 15) - 1
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::cpuboard::tms9995::cpu_core::{Tms9995CruBus, Tms9995Ram};

	#[test]
	fn cru_single_bit_ops_use_r12_base_with_signed_disp() {
		let mut bus = Tms9995Ram::new(0x10000, true);
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
		let mut bus = Tms9995Ram::new(0x10000, true);
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
		let mut bus = Tms9995Ram::new(0x10000, true);
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

	#[test]
	fn phase1_format1_mov_add_soc() {
		let mut bus = Tms9995Ram::new(0x10000, true);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0100u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x1000);
		cpu.reset_from_vector(&bus);

		bus.write_word(wp + 2, 0x1234); // R1
		bus.write_word(wp + 4, 0x0005); // R2
		bus.load_words_be(0x1000, &[0xC042, 0xA042, 0xE042, 0x0340]);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0x0005); // MOV R1,R2
		assert_ne!(cpu.state().st & ST_LGT, 0);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0x000a); // A R1,R2
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0x000f); // SOC R1,R2 (0x0a | 0x05)
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Idle));
	}

	#[test]
	fn phase1_format6_clr_branch_and_link() {
		let mut bus = Tms9995Ram::new(0x10000, true);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0200u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x2000);
		cpu.reset_from_vector(&bus);

		bus.write_word(wp + 2, 0xabcd); // R1
		bus.write_word(wp + 22, 0x3000); // R11 -> target
		// CLR R1; B *R11; BL *R11; IDLE
		bus.load_words_be(0x2000, &[0x04C1, 0x045B, 0x069B, 0x0340]);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0); // CLR R1
		assert_eq!(cpu.state().st & ST_EQ, ST_EQ);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(cpu.state().pc, 0x3000); // B *R11

		cpu.state.pc = 0x2004;
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 22), 0x2006); // BL *R11 saves return PC
		assert_eq!(cpu.state().pc, 0x3000);
	}

	#[test]
	fn phase1_format5_srl_and_format3_xor() {
		let mut bus = Tms9995Ram::new(0x10000, true);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0300u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x4000);
		cpu.reset_from_vector(&bus);

		bus.write_word(wp + 2, 0x8000); // R1
		bus.write_word(wp + 4, 0x00f0); // R2
		bus.load_words_be(0x4000, &[0x0911, 0x2842, 0x0340]);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0x4000); // SRL R1,1
		assert_eq!(cpu.state().st & ST_C, 0);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0x40f0); // XOR R1,R2
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Idle));
	}

	#[test]
	fn phase1_format8_andi_and_ori() {
		let mut bus = Tms9995Ram::new(0x10000, true);
		let mut cru = Tms9995CruBus::default();
		let mut cpu = Tms9995Core::new();

		let wp = 0x0400u16;
		bus.write_word(0, wp);
		bus.write_word(2, 0x5000);
		cpu.reset_from_vector(&bus);

		bus.write_word(wp + 2, 0xabcd); // R1
		bus.load_words_be(0x5000, &[0x0241, 0x00ff, 0x0261, 0xf000, 0x0340]);

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0x00cd); // ANDI R1, >00FF

		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Running));
		assert_eq!(bus.read_word(wp + 2), 0xf0cd); // ORI R1, >F000
		assert_eq!(cpu.step(&mut bus, &mut cru), Ok(StepResult::Idle));
	}
}
