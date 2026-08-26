use super::bus::Mn1613Bus;
use super::error::Mn1613Error;

/// 算術・論理演算で更新される条件フラグ。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Mn1613Flags {
	pub z: bool,
	pub n: bool,
	pub c: bool,
	pub v: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StepResult {
	Running,
	Halted,
}

#[derive(Debug, Clone)]
pub struct Mn1613Core {
	regs: [u16; 8],
	pc: u16,
	// スタックポインタの値。
	// 注: 現在の命令サブセットでは CALL/RET/PUSH/POP を実装していないため、
	// SP はアーキテクチャ状態としてのみ保持する。
	sp: u16,
	flags: Mn1613Flags,
	halted: bool,
}

impl Default for Mn1613Core {
	fn default() -> Self {
		Self::new()
	}
}

impl Mn1613Core {
	/// 電源投入直後の CPU 状態を作成する（全レジスタを 0 クリア）。
	///
	/// 呼び出し契約:
	/// - 引数は不要。
	/// - 返されたコアは `reset` または直接レジスタ設定ですぐ利用できる。
	pub fn new() -> Self {
		Self {
			regs: [0; 8],
			pc: 0,
			sp: 0,
			flags: Mn1613Flags::default(),
			halted: false,
		}
	}

	/// アーキテクチャ状態をリセットする。
	///
	/// 呼び出し契約:
	/// - `pc` は最初に実行する命令ワードアドレス。
	/// - `sp` はそのまま保持されるが、現行命令では未使用。
	/// - 汎用レジスタとフラグはクリアされる。
	pub fn reset(&mut self, pc: u16, sp: u16) {
		self.regs = [0; 8];
		self.pc = pc;
		self.sp = sp;
		self.flags = Mn1613Flags::default();
		self.halted = false;
	}

	/// 汎用レジスタを読み出す。
	///
	/// 呼び出し契約:
	/// - `index` は `0x7` でマスクされる（R0..R7 に折り返し）。
	/// - この関数は失敗しない。
	pub fn reg(&self, index: usize) -> u16 {
		self.regs[index & 0x7]
	}

	/// 汎用レジスタへ書き込む。
	///
	/// 呼び出し契約:
	/// - `index` は `0x7` でマスクされる（R0..R7 に折り返し）。
	/// - この API ヘルパーはフラグを変更しない。
	pub fn set_reg(&mut self, index: usize, value: u16) {
		self.regs[index & 0x7] = value;
	}

	pub fn pc(&self) -> u16 {
		self.pc
	}

	/// 現在のスタックポインタ値を返す。
	///
	/// 呼び出し契約:
	/// - 純粋な getter（副作用なし）。
	/// - スタック命令未実装の段階でも外部ツール/テストで SP を参照できる。
	pub fn sp(&self) -> u16 {
		self.sp
	}

	pub fn flags(&self) -> Mn1613Flags {
		self.flags
	}

	pub fn is_halted(&self) -> bool {
		self.halted
	}

	/// 最大 `max_cycles` 命令まで実行する。
	///
	/// 呼び出し契約:
	/// - 呼び出し側は `Mn1613Bus` 実装の可変 bus を渡す。
	/// - HALT 到達時は実行命令数を返す。
	/// - 予算内で HALT しなければ `MaxCyclesReached` を返す。
	pub fn run<B: Mn1613Bus>(
		&mut self,
		bus: &mut B,
		max_cycles: usize,
	) -> Result<usize, Mn1613Error> {
		// `run` が数えるのは命令数であり、クロックのマイクロサイクルではない。
		for cycles in 1..=max_cycles {
			let res = self.step(bus)?;
			if res == StepResult::Halted {
				return Ok(cycles);
			}
		}
		Err(Mn1613Error::MaxCyclesReached { cycles: max_cycles })
	}

	/// 1 命令を実行する。
	///
	/// 呼び出し契約:
	/// - 呼び出し側はフェッチ/メモリアクセス用の bus 読み書きを提供する。
	/// - すでに HALT 状態なら `StepResult::Halted` を返し、状態は変化しない。
	/// - 不正 opcode の場合は `pc`/`ir` 付きで `Mn1613Error::IllegalInstruction` を返す。
	/// `self.pc` は命令フェッチ後にのみ更新されるため、エラーの `pc` は不正命令アドレスを指す。
	/// `B` は `Mn1613Bus` を実装する汎用 bus 型。
	pub fn step<B: Mn1613Bus>(&mut self, bus: &mut B) -> Result<StepResult, Mn1613Error> {
		if self.halted {
			return Ok(StepResult::Halted);
		}

		let old_pc = self.pc;
		let ir = self.fetch_word(bus);

		// 主経路: MN1613 形式デコード（[op5:5][rrr:3][lo:8]）。
		// ネイティブ命令の拡張に向いた実行経路。
		let op5 = (ir >> 11) & 0x001f;
		let rrr = ((ir >> 8) & 0x0007) as usize;
		let lo = (ir & 0x00ff) as u8;
		if let Some(result) = self.exec_mn1613_primary(op5, rrr, lo, bus) {
			return Ok(result);
		}

		// 互換経路: 既存テストで使う簡易 4bit サブセット。
		self.exec_legacy_4bit(ir, old_pc, bus)
	}

	fn exec_mn1613_primary<B: Mn1613Bus>(
		&mut self,
		op5: u16,
		rrr: usize,
		lo: u8,
		bus: &B,
	) -> Option<StepResult> {
		// H (halt): MN1613 グループ 0x04 のエンコード。
		if op5 == 0x04 && rrr == 0 && lo == 0x00 {
			self.halted = true;
			return Some(StepResult::Halted);
		}

		if self.exec_mn1613_extended(op5, rrr, lo, bus) {
			return Some(StepResult::Running);
		}

		None
	}

	fn exec_legacy_4bit<B: Mn1613Bus>(
		&mut self,
		ir: u16,
		old_pc: u16,
		bus: &mut B,
	) -> Result<StepResult, Mn1613Error> {
		// 16bit 命令形式: [op:4][rd:3][rs:3][minor/immediate-hint:6]
		let op = (ir >> 12) & 0x000f;
		let rd = ((ir >> 9) & 0x0007) as usize;
		let rs = ((ir >> 6) & 0x0007) as usize;

		match op {
			0x0 => {
				// op=0x0 はマイナー命令グループ（NOP/HALT/その他予約）。
				match ir & 0x00ff {
					0x00 => {}
					0x01 => {
						self.halted = true;
						return Ok(StepResult::Halted);
					}
					_ => {
						return Err(Mn1613Error::IllegalInstruction { pc: old_pc, ir });
					}
				}
			}
			0x1 => {
				let imm = self.fetch_word(bus);
				self.regs[rd] = imm;
				self.update_nz(self.regs[rd]);
			}
			0x2 => {
				self.regs[rd] = self.regs[rs];
				self.update_nz(self.regs[rd]);
			}
			0x3 => {
				let (result, carry, overflow) = add_u16(self.regs[rd], self.regs[rs]);
				self.regs[rd] = result;
				self.flags.c = carry;
				self.flags.v = overflow;
				self.update_nz(result);
			}
			0x4 => {
				let (result, borrow, overflow) = sub_u16(self.regs[rd], self.regs[rs]);
				self.regs[rd] = result;
				self.flags.c = !borrow;
				self.flags.v = overflow;
				self.update_nz(result);
			}
			0x5 => {
				// 絶対ロード: 次ワードをワードアドレスとして参照する。
				let addr = self.fetch_word(bus);
				let value = bus.read_word(addr);
				self.regs[rd] = value;
				self.update_nz(value);
			}
			0x6 => {
				// 絶対ストア: C/V は維持し、N/Z のみ更新する。
				let addr = self.fetch_word(bus);
				bus.write_word(addr, self.regs[rd]);
				self.update_nz(self.regs[rd]);
			}
			0x7 => {
				let addr = self.fetch_word(bus);
				self.pc = addr;
			}
			0x8 => {
				let addr = self.fetch_word(bus);
				if self.flags.z {
					self.pc = addr;
				}
			}
			0x9 => {
				let addr = self.fetch_word(bus);
				if !self.flags.z {
					self.pc = addr;
				}
			}
			0xA => {
				let result = self.regs[rd] & self.regs[rs];
				self.regs[rd] = result;
				self.flags.c = false;
				self.flags.v = false;
				self.update_nz(result);
			}
			0xB => {
				let result = self.regs[rd] | self.regs[rs];
				self.regs[rd] = result;
				self.flags.c = false;
				self.flags.v = false;
				self.update_nz(result);
			}
			0xC => {
				let result = self.regs[rd] ^ self.regs[rs];
				self.regs[rd] = result;
				self.flags.c = false;
				self.flags.v = false;
				self.update_nz(result);
			}
			0xD => {
				// Compare は rd-rs を計算し、書き戻しのみ抑止する。
				let (result, borrow, overflow) = sub_u16(self.regs[rd], self.regs[rs]);
				self.flags.c = !borrow;
				self.flags.v = overflow;
				self.update_nz(result);
			}
			_ => {
				return Err(Mn1613Error::IllegalInstruction { pc: old_pc, ir });
			}
		}

		Ok(StepResult::Running)
	}

	fn fetch_word<B: Mn1613Bus>(&mut self, bus: &B) -> u16 {
		// 命令フェッチはワードアドレッシング。PC は 1 ワード進む。
		let w = bus.read_word(self.pc);
		self.pc = self.pc.wrapping_add(1);
		w
	}

	fn update_nz(&mut self, value: u16) {
		// 全命令で N/Z 更新ルールをそろえるための共通ヘルパー。
		self.flags.z = value == 0;
		self.flags.n = (value & 0x8000) != 0;
	}

	fn update_nz_pair(&mut self, hi: u16, lo: u16) {
		self.flags.z = hi == 0 && lo == 0;
		self.flags.n = (hi & 0x8000) != 0;
	}

	fn ri(&self, ii: u8) -> u16 {
		let idx = usize::from((ii & 0x03) + 1);
		self.regs[idx]
	}

	fn exec_mn1613_extended<B: Mn1613Bus>(&mut self, op5: u16, rrr: usize, lo: u8, bus: &B) -> bool {
		let b32 = (lo >> 2) & 0x03;
		let ii = lo & 0x03;

		// M DR0, (Ri): op5=0x0F, rrr=7, b32=3
		if op5 == 0x0F && rrr == 7 && b32 == 3 {
			let m = u32::from(bus.read_word(self.ri(ii)));
			let p = u32::from(self.regs[0]) * m;
			self.regs[0] = ((p >> 16) & 0xffff) as u16;
			self.regs[1] = (p & 0xffff) as u16;
			self.flags.c = false;
			self.flags.v = false;
			self.update_nz_pair(self.regs[0], self.regs[1]);
			return true;
		}

		// D DR0, (Ri): op5=0x0E, rrr=7, b32=3
		if op5 == 0x0E && rrr == 7 && b32 == 3 {
			let div = u32::from(bus.read_word(self.ri(ii)));
			self.flags.c = false;
			if div == 0 {
				self.flags.v = true;
				return true;
			}
			let n32 = (u32::from(self.regs[0]) << 16) | u32::from(self.regs[1]);
			let q = n32 / div;
			let r = n32 % div;
			if q > 0xffff {
				self.flags.v = true;
				return true;
			}
			self.flags.v = false;
			self.regs[0] = q as u16;
			self.regs[1] = r as u16;
			self.update_nz(self.regs[0]);
			return true;
		}

		// FIX/FLT: op5=0x03, rrr=7, bit2=1
		if op5 == 0x03 && rrr == 7 && (lo & 0x04) != 0 {
			self.flags.c = false;
			if (lo & 0x08) == 0 {
				// FIX R0, DR0（浮動小数点 -> int16）
				let v = fp_from_words(self.regs[0], self.regs[1]).trunc();
				let ov = !v.is_finite() || v > f64::from(i16::MAX) || v < f64::from(i16::MIN);
				self.flags.v = ov;
				self.regs[0] = if ov { 0 } else { (v as i16) as u16 };
				self.update_nz(self.regs[0]);
			} else {
				// FLT DR0, R0（int16 -> 浮動小数点）
				let s16 = (self.regs[0] as i16) as f64;
				let (w0, w1, ov) = fp_to_words(s16);
				self.regs[0] = w0;
				self.regs[1] = w1;
				self.flags.v = ov;
				self.update_nz_pair(self.regs[0], self.regs[1]);
			}
			return true;
		}

		// FM/FD: op5=0x0C, rrr=7, b32=3 または 1
		if op5 == 0x0C && rrr == 7 && (b32 == 3 || b32 == 1) {
			let ea = self.ri(ii);
			let rhs = fp_from_words(bus.read_word(ea), bus.read_word(ea.wrapping_add(1)));
			if b32 == 1 && rhs == 0.0 {
				self.flags.c = false;
				self.flags.v = true;
				return true;
			}
			let lhs = fp_from_words(self.regs[0], self.regs[1]);
			let out = if b32 == 3 { lhs * rhs } else { lhs / rhs };
			let (w0, w1, ov) = fp_to_words(out);
			self.regs[0] = w0;
			self.regs[1] = w1;
			self.flags.c = false;
			self.flags.v = ov;
			self.update_nz_pair(self.regs[0], self.regs[1]);
			return true;
		}

		// FA/FS: op5=0x0D, rrr=7, b32=3 または 1
		if op5 == 0x0D && rrr == 7 && (b32 == 3 || b32 == 1) {
			let ea = self.ri(ii);
			let rhs = fp_from_words(bus.read_word(ea), bus.read_word(ea.wrapping_add(1)));
			let lhs = fp_from_words(self.regs[0], self.regs[1]);
			let out = if b32 == 3 { lhs + rhs } else { lhs - rhs };
			let (w0, w1, ov) = fp_to_words(out);
			self.regs[0] = w0;
			self.regs[1] = w1;
			self.flags.c = false;
			self.flags.v = ov;
			self.update_nz_pair(self.regs[0], self.regs[1]);
			return true;
		}

		false
	}
}

/// 16bit 加算の (result, carry, overflow) を返す。
/// 符号付きオーバーフローは「同符号入力で結果符号が反転した場合」と定義する。
/// * `a` と `b` は入力オペランド。
/// * `result` は 16bit の加算結果。
/// * `carry` は最上位ビットから桁上がりが出たとき true。
fn add_u16(a: u16, b: u16) -> (u16, bool, bool) {
	let (r, c) = a.overflowing_add(b);
	// 符号付きオーバーフロー: 同符号入力で結果符号が反転したとき。
	let sa = (a & 0x8000) != 0;
	let sb = (b & 0x8000) != 0;
	let sr = (r & 0x8000) != 0;
	let v = (sa == sb) && (sa != sr);
	(r, c, v)
}

/// 16bit 減算の (result, borrow, overflow) を返す。
/// 符号付きオーバーフローは「異符号入力で結果符号が被減数と反転した場合」と定義する。
/// * `a` と `b` は入力オペランド。
/// * `result` は 16bit の減算結果。
/// * `borrow` は借りが発生したとき true（`a < b`）。
fn sub_u16(a: u16, b: u16) -> (u16, bool, bool) {
	let (r, borrow) = a.overflowing_sub(b);
	// 符号付きオーバーフロー: 異符号入力で結果符号が lhs から反転したとき。
	let sa = (a & 0x8000) != 0;
	let sb = (b & 0x8000) != 0;
	let sr = (r & 0x8000) != 0;
	let v = (sa != sb) && (sa != sr);
	(r, borrow, v)
}

/// MN1613 形式の 2 ワード（w0, w1）を浮動小数点値へ変換する。
/// * `w0` は符号・指数・仮数上位を含む上位ワード。
/// * `w1` は仮数下位を含む下位ワード。
/// * 対応する `f64` を返す。両方 0 の場合は `0.0`。
fn fp_from_words(w0: u16, w1: u16) -> f64 {
	if (w0 | w1) == 0 {
		return 0.0;
	}
	let sign = (w0 >> 15) & 0x1;
	let exp = ((w0 >> 8) & 0x7f) as i32;
	let mant = (((w0 & 0x00ff) as u32) << 16) | u32::from(w1);
	let val = (mant as f64) * 16f64.powi(exp - 70);
	if sign != 0 {
		-val
	} else {
		val
	}
}

fn fp_to_words(v: f64) -> (u16, u16, bool) {
	if v == 0.0 {
		return (0, 0, false);
	}
	if !v.is_finite() {
		return (0, 0, true);
	}

	let sign = if v < 0.0 { 1u16 } else { 0u16 };
	let abs = v.abs();
	let mut exp = (abs.log(16.0).floor() as i32) + 65;

	let mut mant = (abs * 16f64.powi(70 - exp)).round();
	while mant < 0x100000 as f64 && exp > 0 {
		mant *= 16.0;
		exp -= 1;
	}
	while mant >= 0x1000000 as f64 && exp < 127 {
		mant = (mant / 16.0).floor();
		exp += 1;
	}

	if exp < 0 || mant < 0x100000 as f64 {
		return (0, 0, false);
	}
	if exp > 127 || mant >= 0x1000000 as f64 {
		return (0, 0, true);
	}

	let mant_u = (mant as u32) & 0x00ff_ffff;
	let w0 = (sign << 15) | (((exp as u16) & 0x7f) << 8) | ((mant_u >> 16) as u16 & 0x00ff);
	let w1 = (mant_u & 0xffff) as u16;
	(w0, w1, false)
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::cpu_core::mn1613::Mn1613Ram;

	fn op(op: u16, rd: u16, rs: u16) -> u16 {
		(op << 12) | ((rd & 0x7) << 9) | ((rs & 0x7) << 6)
	}

	#[test]
	fn load_add_store_and_halt() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x100);

		ram.load_words(
			0,
			&[
				op(0x1, 0, 0),
				10,
				op(0x1, 1, 0),
				20,
				op(0x3, 0, 1),
				op(0x6, 0, 0),
				0x0040,
				0x0001,
			],
		);

		cpu.reset(0, 0);
		let cycles = cpu.run(&mut ram, 32).expect("program should halt");

		assert!(cpu.is_halted());
		assert_eq!(cycles, 5);
		assert_eq!(cpu.reg(0), 30);
		assert_eq!(ram.read_word(0x0040), 30);
	}

	#[test]
	fn branch_on_zero() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x100);

		ram.load_words(
			0,
			&[
				op(0x1, 0, 0),
				0,
				op(0x8, 0, 0),
				0x0008,
				op(0x1, 1, 0),
				0x1111,
				0x0001,
				0x0000,
				op(0x1, 1, 0),
				0x2222,
				0x0001,
			],
		);

		cpu.reset(0, 0);
		let _ = cpu.run(&mut ram, 32).expect("program should halt");

		assert_eq!(cpu.reg(1), 0x2222);
	}

	#[test]
	fn illegal_instruction_error() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x10);

		ram.load_words(0, &[0xE000]);
		cpu.reset(0, 0);

		let err = cpu.step(&mut ram).expect_err("should fail");
		assert_eq!(err, Mn1613Error::IllegalInstruction { pc: 0, ir: 0xE000 });
	}

	#[test]
	fn mn1613_m_instruction() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x100);
		ram.load_words(0, &[0x7f0c, 0x0001]);
		ram.load_words(0x20, &[3]);

		cpu.reset(0, 0);
		cpu.set_reg(0, 4);
		cpu.set_reg(1, 0x20);
		let _ = cpu.run(&mut ram, 8).expect("program should halt");

		assert_eq!(cpu.reg(0), 0);
		assert_eq!(cpu.reg(1), 12);
		assert!(!cpu.flags().v);
	}

	#[test]
	fn mn1613_d_instruction() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x100);
		ram.load_words(0, &[0x770d, 0x0001]);
		ram.load_words(0x30, &[10]);

		cpu.reset(0, 0);
		cpu.set_reg(0, 0x0001);
		cpu.set_reg(1, 0x0004);
		cpu.set_reg(2, 0x0030);
		let _ = cpu.run(&mut ram, 8).expect("program should halt");

		assert_eq!(cpu.reg(0), 6554);
		assert_eq!(cpu.reg(1), 0);
		assert!(!cpu.flags().v);
	}

	#[test]
	fn mn1613_flt_then_fix_roundtrip() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x100);
		ram.load_words(0, &[0x1f0c, 0x1f04, 0x0001]);

		cpu.reset(0, 0);
		cpu.set_reg(0, 123);
		let _ = cpu.run(&mut ram, 16).expect("program should halt");

		assert_eq!(cpu.reg(0), 123);
		assert!(!cpu.flags().v);
	}

	#[test]
	fn mn1613_native_halt_opcode() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new(0x10);
		ram.load_words(0, &[0x2000]);

		cpu.reset(0, 0);
		let cycles = cpu.run(&mut ram, 1).expect("program should halt");

		assert!(cpu.is_halted());
		assert_eq!(cycles, 1);
	}
}
