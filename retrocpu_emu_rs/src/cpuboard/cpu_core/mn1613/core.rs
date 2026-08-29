//! Panasonic MN1613 CPU コア（`retrocpu_emu_ts` の mn1613.ts 準拠）。

use std::collections::HashSet;

use super::bus::{phys, Mn1613Ram, PHYS_MASK};
use super::error::Mn1613Error;

/// E フラグ（拡張／キャリー）
pub const STR_E: u16 = 0x8000;
/// OVF フラグ
pub const STR_OVF: u16 = 0x2000;
/// 割り込みマスク level0
pub const STR_M0: u16 = 0x0400;
/// 割り込みマスク level1
pub const STR_M1: u16 = 0x0200;
/// 割り込みマスク level2
pub const STR_M2: u16 = 0x0100;
/// IISR 未定義命令フラグ
pub const IISR_UNDEF: u16 = 0x0001;
/// 1 メモリアクセスあたりのクロック
pub const CPU_CLK_PER_ACCESS: u64 = 4;

/// CPU 実行状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecStatus {
	Idle,
	Running,
	Step,
	Break,
	Halted,
}

/// CPU レジスタ一式。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CpuRegister {
	pub r: [u16; 5],
	pub sp: u16,
	pub str: u16,
	pub ic: u16,
	pub csbr: u8,
	pub ssbr: u8,
	pub tsr0: u8,
	pub tsr1: u8,
	pub osr: [u8; 4],
	pub npp: u8,
	pub iisr: u16,
	pub sbrb: u16,
	pub icb: u16,
}

impl Default for CpuRegister {
	fn default() -> Self {
		Self {
			r: [0; 5],
			sp: 0,
			str: 0,
			ic: 0,
			csbr: 0,
			ssbr: 0,
			tsr0: 0,
			tsr1: 0,
			osr: [0; 4],
			npp: 0x01,
			iisr: 0,
			sbrb: 0,
			icb: 0,
		}
	}
}

/// IO ポート読み書き。
pub trait IoCallbacks {
	/// ポートから 16bit を読む。
	fn io_read(&mut self, port: u16) -> u16;
	/// ポートへ 16bit を書く。
	fn io_write(&mut self, port: u16, val: u16);
}

/// 既定 IO（読取 `0xFFFF`、書込 NOP）。
#[derive(Debug, Default)]
pub struct NullIo;

impl IoCallbacks for NullIo {
	fn io_read(&mut self, _port: u16) -> u16 {
		0xffff
	}
	fn io_write(&mut self, _port: u16, _val: u16) {}
}

/// メモリアクセス通知（比較器フック用。本体は未実装）。
#[derive(Debug, Clone, Copy)]
pub struct MemAccessEvent {
	pub phys: u32,
	pub write: bool,
	/// 命令フェッチなら true（データアクセスは false）。
	pub fetch: bool,
	pub data: u16,
	pub prev: u16,
}

type MemHook = Box<dyn FnMut(MemAccessEvent)>;
type OnStop = Box<dyn FnMut(ExecStatus, &CpuRegister)>;
type OnTrace = Box<dyn FnMut(&CpuRegister, &Mn1613Ram)>;

/// MN1613 CPU コア。
pub struct Mn1613Core {
	regs: CpuRegister,
	exec_status: ExecStatus,
	breakpoints: HashSet<u16>,
	step_mode: bool,
	pending_irq: u8,
	clock_count: u64,
	io: Box<dyn IoCallbacks>,
	mem_hook: Option<MemHook>,
	on_stop: Option<OnStop>,
	on_before: Option<OnTrace>,
	on_after: Option<OnTrace>,
	/// フェッチ中フラグ（mem_hook の fetch 区別用）。
	fetching: bool,
}

impl Default for Mn1613Core {
	fn default() -> Self {
		Self::new()
	}
}

impl Mn1613Core {
	/// 電源投入前の空コアを作る（`power_on_idle` 相当の初期値）。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			regs: CpuRegister::default(),
			exec_status: ExecStatus::Idle,
			breakpoints: HashSet::new(),
			step_mode: false,
			pending_irq: 0,
			clock_count: 0,
			io: Box::new(NullIo),
			mem_hook: None,
			on_stop: None,
			on_before: None,
			on_after: None,
			fetching: false,
		}
	}

	/// IO コールバックを差し替える。
	///
	/// # Arguments
	/// - `io`: ポートアクセス実装
	pub fn set_io_callbacks(&mut self, io: Box<dyn IoCallbacks>) {
		self.io = io;
	}

	/// メモリプローブフック（比較器用。未使用可）。
	///
	/// # Arguments
	/// - `hook`: 読み書きイベント受信用フック（不要なら `None`）
	pub fn set_mem_hook(&mut self, hook: Option<MemHook>) {
		self.mem_hook = hook;
	}

	/// 停止コールバックを登録する。
	///
	/// # Arguments
	/// - `cb`: 停止時に呼ぶコールバック（解除は `None`）
	pub fn set_on_stop(&mut self, cb: Option<OnStop>) {
		self.on_stop = cb;
	}

	/// 命令フェッチ直前トレース（テスト用）。
	///
	/// # Arguments
	/// - `cb`: 命令実行前トレースコールバック（解除は `None`）
	pub fn set_on_before_execute(&mut self, cb: Option<OnTrace>) {
		self.on_before = cb;
	}

	/// 命令実行直後トレース（テスト用）。
	///
	/// # Arguments
	/// - `cb`: 命令実行後トレースコールバック（解除は `None`）
	pub fn set_on_after_execute(&mut self, cb: Option<OnTrace>) {
		self.on_after = cb;
	}

	/// 電源投入直後: レジスタ初期化のみ（IO:0 は読まない）。
	pub fn power_on_idle(&mut self) {
		self.regs = CpuRegister::default();
		self.exec_status = ExecStatus::Idle;
		self.step_mode = false;
		self.pending_irq = 0;
		self.clock_count = 0;
	}

	/// CPU リセット（IO:0 → ベクタ表。mem[base+2]=STR、mem[base+3]=IC）。
	///
	/// # Arguments
	/// - `ram`: リセットベクタ表を読むメモリ
	pub fn reset(&mut self, ram: &Mn1613Ram) {
		self.regs = CpuRegister::default();
		self.step_mode = false;
		self.pending_irq = 0;
		let vec = self.io.io_read(0) & 0xffff;
		self.regs.str = ram.peek_word(vec.wrapping_add(2));
		self.regs.ic = ram.peek_word(vec.wrapping_add(3));
		self.clock_count = 0;
		self.exec_status = ExecStatus::Running;
	}

	/// レジスタスナップショットを返す。
	///
	/// # Returns
	/// - 現在のレジスタ状態のコピー
	pub fn get_state(&self) -> CpuRegister {
		self.regs.clone()
	}

	/// レジスタを部分更新する。
	///
	/// # Arguments
	/// - `patch`: `Some` の項目だけ反映する更新パッチ
	pub fn set_state(&mut self, patch: &CpuRegisterPatch) {
		if let Some(r) = &patch.r {
			for i in 0..5 {
				if let Some(v) = r[i] {
					self.regs.r[i] = v;
				}
			}
		}
		if let Some(o) = &patch.osr {
			for i in 0..4 {
				if let Some(v) = o[i] {
					self.regs.osr[i] = v & 0xf;
				}
			}
		}
		if let Some(v) = patch.sp {
			self.regs.sp = v;
		}
		if let Some(v) = patch.str {
			self.regs.str = v;
		}
		if let Some(v) = patch.ic {
			self.regs.ic = v;
		}
		if let Some(v) = patch.csbr {
			self.regs.csbr = v & 0xf;
		}
		if let Some(v) = patch.ssbr {
			self.regs.ssbr = v & 0xf;
		}
		if let Some(v) = patch.tsr0 {
			self.regs.tsr0 = v & 0xf;
		}
		if let Some(v) = patch.tsr1 {
			self.regs.tsr1 = v & 0xf;
		}
		if let Some(v) = patch.npp {
			self.regs.npp = v;
		}
		if let Some(v) = patch.iisr {
			self.regs.iisr = v;
		}
		if let Some(v) = patch.sbrb {
			self.regs.sbrb = v;
		}
		if let Some(v) = patch.icb {
			self.regs.icb = v;
		}
	}

	/// 実行状態を返す。
	///
	/// # Returns
	/// - 現在の実行状態
	pub fn get_exec_status(&self) -> ExecStatus {
		self.exec_status
	}

	/// 実行状態を強制設定する（テスト用）。
	///
	/// # Arguments
	/// - `s`: 設定する実行状態
	pub fn set_exec_status(&mut self, s: ExecStatus) {
		self.exec_status = s;
	}

	/// リセット以降の CPU クロック数（64bit ラップ）。
	///
	/// # Returns
	/// - 加算済みクロック数
	pub fn get_clock_count(&self) -> u64 {
		self.clock_count
	}

	/// ソフトブレイクポイントを追加する。
	///
	/// # Arguments
	/// - `addr`: 追加する命令アドレス
	pub fn add_breakpoint(&mut self, addr: u16) {
		self.breakpoints.insert(addr);
	}

	/// ソフトブレイクポイントを削除する。
	///
	/// # Arguments
	/// - `addr`: 削除する命令アドレス
	pub fn remove_breakpoint(&mut self, addr: u16) {
		self.breakpoints.remove(&addr);
	}

	/// ソフトブレイクポイントを全削除する。
	pub fn clear_breakpoints(&mut self) {
		self.breakpoints.clear();
	}

	/// 設定済みブレイクポイントを返す。
	///
	/// # Returns
	/// - 現在登録されているブレイクポイント集合
	pub fn get_breakpoints(&self) -> &HashSet<u16> {
		&self.breakpoints
	}

	/// ステップモードを切り替える。
	///
	/// # Arguments
	/// - `enable`: `true` でステップモードを有効化
	pub fn set_step_mode(&mut self, enable: bool) {
		self.step_mode = enable;
		if enable && self.exec_status == ExecStatus::Running {
			self.exec_status = ExecStatus::Step;
		}
	}

	/// 割り込み要求（level 0〜2）。
	///
	/// # Arguments
	/// - `level`: 割り込みレベル（0〜2。範囲外は無視）
	pub fn trigger_interrupt(&mut self, level: u8) {
		if level <= 2 {
			self.pending_irq |= 1 << level;
		}
	}

	/// ペンディング IRQ マスク（テスト用）。
	///
	/// # Returns
	/// - 保留中 IRQ ビットマスク
	pub fn get_pending_irq(&self) -> u8 {
		self.pending_irq
	}

	/// 実行を強制停止する。
	pub fn halt(&mut self) {
		self.exec_status = ExecStatus::Halted;
	}

	/// 1 命令実行して状態を返す（ステップ停止）。
	///
	/// # Arguments
	/// - `ram`: 命令・データを読むメモリ
	///
	/// # Returns
	/// - 実行後のレジスタ状態コピー
	pub fn step(&mut self, ram: &mut Mn1613Ram) -> CpuRegister {
		// HALT 中でも、受理可能な IRQ が来ていれば実行再開できる。
		if self.exec_status == ExecStatus::Halted {
			if !self.has_acceptable_irq() {
				return self.get_state();
			}
			self.exec_status = ExecStatus::Running;
		}
		// step() は「1命令だけ進める」ため、常に step_mode をいったん解除してから実行する。
		self.step_mode = false;
		self.exec_status = ExecStatus::Running;
		self.execute_one(ram);
		if self.exec_status != ExecStatus::Halted {
			self.exec_status = ExecStatus::Step;
			self.fire_stop();
		}
		self.get_state()
	}

	/// メインループ用: 実行中なら 1 命令。
	///
	/// # Arguments
	/// - `ram`: 命令・データを読むメモリ
	pub fn tick(&mut self, ram: &mut Mn1613Ram) {
		if self.exec_status == ExecStatus::Idle {
			return;
		}
		// HALT 中は通常停止のまま。IRQ が受理可能になったときだけ復帰する。
		if self.exec_status == ExecStatus::Halted {
			if !self.has_acceptable_irq() {
				return;
			}
			self.exec_status = ExecStatus::Running;
		}
		if self.exec_status == ExecStatus::Break || self.exec_status == ExecStatus::Step {
			return;
		}
		if self.breakpoints.contains(&self.regs.ic) {
			self.exec_status = ExecStatus::Break;
			self.fire_stop();
			return;
		}
		self.execute_one(ram);
	}

	/// 最大 `max_inst` 命令まで連続実行する。
	///
	/// # Arguments
	/// - `ram`: 命令・データを読むメモリ
	/// - `start_addr`: `Some` の場合は実行開始前に `IC` へ設定
	/// - `max_inst`: 実行上限命令数（`0` は上限なし）
	///
	/// # Returns
	/// - 停止時の実行状態（`Break` / `Step` / `Halted`）
	///
	/// # Errors
	/// - `Mn1613Error::MaxCyclesReached`: `max_inst` 上限に到達した場合
	pub fn run_slice(
		&mut self,
		ram: &mut Mn1613Ram,
		start_addr: Option<u16>,
		max_inst: usize,
	) -> Result<ExecStatus, Mn1613Error> {
		// start_addr が Some のときだけ、実行開始アドレスを上書きする。
		if let Some(a) = start_addr {
			self.regs.ic = a;
		}
		self.exec_status = ExecStatus::Running;
		self.step_mode = false;
		let mut cycles = 0usize;
		loop {
			if self.breakpoints.contains(&self.regs.ic) {
				self.exec_status = ExecStatus::Break;
				self.fire_stop();
				return Ok(self.exec_status);
			}
			if self.step_mode {
				self.exec_status = ExecStatus::Step;
				self.fire_stop();
				return Ok(self.exec_status);
			}
			self.execute_one(ram);
			if self.exec_status == ExecStatus::Halted {
				self.fire_stop();
				return Ok(self.exec_status);
			}
			// max_inst == 0 は「上限なし」の意味。
			if max_inst > 0 {
				cycles += 1;
				if cycles >= max_inst {
					return Err(Mn1613Error::MaxCyclesReached { cycles });
				}
			}
		}
	}

	fn fire_stop(&mut self) {
		if let Some(mut cb) = self.on_stop.take() {
			// Option::take() で一時的に所有権を取り出して呼び出し、
			// 呼び出し後に戻す。これで &mut self とコールバック可変参照の
			// 二重借用を避けられる。
			cb(self.exec_status, &self.regs);
			self.on_stop = Some(cb);
		}
	}

	fn has_acceptable_irq(&self) -> bool {
		let masks = [STR_M0, STR_M1, STR_M2];
		for lv in 0..=2 {
			if (self.pending_irq & (1 << lv)) != 0 && (self.regs.str & masks[lv]) != 0 {
				return true;
			}
		}
		false
	}

	fn add_clocks(&mut self, n: u64) {
		if n > 0 {
			self.clock_count = self.clock_count.wrapping_add(n);
		}
	}

	fn rd_phys(&mut self, ram: &mut Mn1613Ram, phys_addr: u32) -> u16 {
		self.add_clocks(CPU_CLK_PER_ACCESS);
		let p = phys_addr & PHYS_MASK;
		let v = ram.read_phys(p);
		let fetch = self.fetching;
		if let Some(hook) = self.mem_hook.as_mut() {
			hook(MemAccessEvent {
				phys: p,
				write: false,
				fetch,
				data: v,
				prev: 0,
			});
		}
		v
	}

	fn wr_phys(&mut self, ram: &mut Mn1613Ram, phys_addr: u32, val: u16) {
		self.add_clocks(CPU_CLK_PER_ACCESS);
		let p = phys_addr & PHYS_MASK;
		let prev = ram.read_phys(p);
		let after = val;
		ram.write_phys(p, after);
		if let Some(hook) = self.mem_hook.as_mut() {
			hook(MemAccessEvent {
				phys: p,
				write: true,
				fetch: false,
				data: after,
				prev,
			});
		}
	}

	fn rd_c(&mut self, ram: &mut Mn1613Ram, la: u16) -> u16 {
		self.rd_phys(ram, phys(la, self.regs.csbr))
	}

	fn wr_c(&mut self, ram: &mut Mn1613Ram, la: u16, v: u16) {
		self.wr_phys(ram, phys(la, self.regs.csbr), v);
	}

	fn rd_s(&mut self, ram: &mut Mn1613Ram, la: u16) -> u16 {
		self.rd_phys(ram, phys(la, self.regs.ssbr))
	}

	fn wr_s(&mut self, ram: &mut Mn1613Ram, la: u16, v: u16) {
		self.wr_phys(ram, phys(la, self.regs.ssbr), v);
	}

	fn rd_b(&mut self, ram: &mut Mn1613Ram, la: u16, seg: u8) -> u16 {
		self.rd_phys(ram, phys(la, seg))
	}

	fn wr_b(&mut self, ram: &mut Mn1613Ram, la: u16, v: u16, seg: u8) {
		self.wr_phys(ram, phys(la, seg), v);
	}

	fn fetch(&mut self, ram: &mut Mn1613Ram) -> u16 {
		// メモリフックに「命令フェッチ中」のアクセスだと伝えるためのフラグ。
		self.fetching = true;
		let w = self.rd_c(ram, self.regs.ic);
		self.fetching = false;
		self.regs.ic = self.regs.ic.wrapping_add(1);
		w
	}

	fn do_io_read(&mut self, port: u16) -> u16 {
		self.add_clocks(CPU_CLK_PER_ACCESS);
		self.io.io_read(port)
	}

	fn do_io_write(&mut self, port: u16, val: u16) {
		self.add_clocks(CPU_CLK_PER_ACCESS);
		self.io.io_write(port & 0xffff, val & 0xffff);
	}

	fn gr(&self, rrr: u16) -> u16 {
		match rrr & 7 {
			0 => self.regs.r[0],
			1 => self.regs.r[1],
			2 => self.regs.r[2],
			3 => self.regs.r[3],
			4 => self.regs.r[4],
			5 => self.regs.sp,
			6 => self.regs.str,
			_ => self.regs.ic,
		}
	}

	fn sw(&mut self, rrr: u16, v: u16) {
		let v = v & 0xffff;
		match rrr & 7 {
			0 => self.regs.r[0] = v,
			1 => self.regs.r[1] = v,
			2 => self.regs.r[2] = v,
			3 => self.regs.r[3] = v,
			4 => self.regs.r[4] = v,
			5 => self.regs.sp = v,
			6 => self.regs.str = v,
			_ => self.regs.ic = v,
		}
	}

	fn ri(&self, ii: u16) -> u16 {
		self.regs.r[((ii & 3) + 1) as usize]
	}

	fn ri_set(&mut self, ii: u16, v: u16) {
		self.regs.r[((ii & 3) + 1) as usize] = v & 0xffff;
	}

	fn seg(&self, bb: u16) -> u8 {
		match bb & 3 {
			0 => self.regs.csbr,
			1 => self.regs.ssbr,
			2 => self.regs.tsr0,
			_ => self.regs.tsr1,
		}
	}

	fn ea(&mut self, ram: &mut Mn1613Ram, mmm: u16, d: u16) -> u16 {
		let sd = if d < 0x80 {
			d as i16
		} else {
			(d as i16) - 0x100
		};
		let insn_ic = self.regs.ic.wrapping_sub(1);
		match mmm & 7 {
			0 => d & 0xff,
			1 => insn_ic.wrapping_add(sd as u16),
			2 => self.rd_c(ram, d & 0xff),
			3 => self.rd_c(ram, insn_ic.wrapping_add(sd as u16)),
			4 => self.regs.r[3].wrapping_add(d & 0xff),
			5 => self.regs.r[4].wrapping_add(d & 0xff),
			6 => {
				let ind = self.rd_c(ram, d & 0xff);
				self.regs.r[3].wrapping_add(ind)
			}
			_ => {
				let ind = self.rd_c(ram, d & 0xff);
				self.regs.r[4].wrapping_add(ind)
			}
		}
	}

	fn skip_cond(&self, kkkk: u16, result: u16) -> bool {
		let n = (result & 0x8000) != 0;
		let z = (result & 0xffff) == 0;
		let e = (self.regs.str & STR_E) != 0;
		let v = (self.regs.str & STR_OVF) != 0;
		match kkkk & 0xf {
			0x0 => false,
			0x1 => true,
			0x2 => n,
			0x3 => !n,
			0x4 => z,
			0x5 => !z,
			0x6 => n || z,
			0x7 => !n && !z,
			0x8 => !e,
			0x9 => e,
			0xa => !v,
			0xb => v,
			0xc => e || z,
			0xd => !e && !z,
			0xe => !e,
			_ => e && !z,
		}
	}

	fn is_2word(ir: u16) -> bool {
		let op = (ir >> 11) & 0x1f;
		let rrr = (ir >> 8) & 0x7;
		let lo = ir & 0xff;
		let b10 = lo & 0xf;
		match op {
			0x01 => rrr == 7 && (lo & 7) == 7,
			0x02 => rrr == 7 && lo != 0x0f && lo != 0x07,
			0x04 => {
				if rrr == 7 && (lo & 0x08) != 0 {
					true
				} else {
					rrr == 6 && (lo == 0x07 || lo == 0x17)
				}
			}
			0x08 | 0x09 => rrr == 7 && (lo & 0x04) != 0,
			0x0a | 0x0b | 0x0c | 0x0d => rrr != 7 && (b10 == 0xf || b10 == 0x7),
			0x0f => b10 == 0x7,
			_ => false,
		}
	}

	fn skip_next(&mut self, ram: &mut Mn1613Ram) {
		let ir = self.rd_c(ram, self.regs.ic);
		self.regs.ic = self.regs.ic.wrapping_add(1);
		if Self::is_2word(ir) {
			self.regs.ic = self.regs.ic.wrapping_add(1);
		}
	}

	fn set_e(&mut self, v: bool) {
		if v {
			self.regs.str |= STR_E;
		} else {
			self.regs.str &= !STR_E;
		}
	}

	fn set_ovf(&mut self, v: bool) {
		if v {
			self.regs.str |= STR_OVF;
		} else {
			self.regs.str &= !STR_OVF;
		}
	}

	fn add16(&mut self, a: u16, b: u16) -> u16 {
		let res = (a as u32) + (b as u32);
		self.set_e(res > 0xffff);
		self.set_ovf((!(a ^ b) & (a ^ (res as u16)) & 0x8000) != 0);
		(res & 0xffff) as u16
	}

	fn sub16(&mut self, a: u16, b: u16) -> u16 {
		let res = (a as i32) - (b as i32);
		self.set_e(res < 0);
		self.set_ovf(((a ^ b) & (a ^ (res as u16)) & 0x8000) != 0);
		(res as u16) & 0xffff
	}

	fn apply_ee(&mut self, ee: u16) {
		match ee & 3 {
			1 => self.set_e(false),
			2 => self.set_e(true),
			3 => {
				let e = (self.regs.str & STR_E) == 0;
				self.set_e(e);
			}
			_ => {}
		}
	}

	fn push(&mut self, ram: &mut Mn1613Ram, v: u16) {
		self.wr_s(ram, self.regs.sp, v);
		self.regs.sp = self.regs.sp.wrapping_sub(1);
	}

	fn pop(&mut self, ram: &mut Mn1613Ram) -> u16 {
		self.regs.sp = self.regs.sp.wrapping_add(1);
		self.rd_s(ram, self.regs.sp)
	}

	fn accept_irq(&mut self, ram: &mut Mn1613Ram, lv: usize) {
		self.pending_irq &= !(1 << lv);
		self.regs.osr[lv] = self.regs.csbr & 0xf;
		self.regs.csbr = 0;
		self.wr_phys(ram, phys((lv * 2) as u16, 0), self.regs.str);
		self.wr_phys(ram, phys((lv * 2 + 1) as u16, 0), self.regs.ic);
		let npsw = (self.regs.npp as u16) << 8;
		self.regs.str = self.rd_phys(ram, phys(npsw.wrapping_add((lv * 2) as u16), 0));
		self.regs.ic = self.rd_phys(ram, phys(npsw.wrapping_add((lv * 2 + 1) as u16), 0));
	}

	fn handle_irq(&mut self, ram: &mut Mn1613Ram) {
		let masks = [STR_M0, STR_M1, STR_M2];
		for lv in 0..=2 {
			if (self.pending_irq & (1 << lv)) != 0 && (self.regs.str & masks[lv]) != 0 {
				self.accept_irq(ram, lv);
				break;
			}
		}
	}

	fn trap_undefined(&mut self, ram: &mut Mn1613Ram) {
		self.regs.iisr |= IISR_UNDEF;
		self.accept_irq(ram, 0);
	}

	fn get_seg_reg(&self, bbb: u16) -> u16 {
		match bbb & 7 {
			0 => self.regs.csbr as u16,
			1 => self.regs.ssbr as u16,
			2 => self.regs.tsr0 as u16,
			3 => self.regs.tsr1 as u16,
			4 => self.regs.osr[0] as u16,
			5 => self.regs.osr[1] as u16,
			6 => self.regs.osr[2] as u16,
			_ => self.regs.osr[3] as u16,
		}
	}

	fn set_seg_reg(&mut self, bbb: u16, v: u16) {
		let v = (v & 0xf) as u8;
		match bbb & 7 {
			1 => self.regs.ssbr = v,
			2 => self.regs.tsr0 = v,
			3 => self.regs.tsr1 = v,
			4 => self.regs.osr[0] = v,
			5 => self.regs.osr[1] = v,
			6 => self.regs.osr[2] = v,
			7 => self.regs.osr[3] = v,
			_ => {}
		}
	}

	fn get_spec_reg(&self, ppp: u16) -> u16 {
		match ppp & 7 {
			0 => self.regs.sbrb,
			1 => self.regs.icb,
			2 => self.regs.npp as u16,
			_ => 0,
		}
	}

	fn set_spec_reg(&mut self, ppp: u16, v: u16) {
		match ppp & 7 {
			0 => self.regs.sbrb = v & 0xff,
			1 => self.regs.icb = v & 0xffff,
			2 => self.regs.npp = (v & 0xff) as u8,
			_ => {}
		}
	}

	fn get_hw_reg(&self, hhh: u16) -> u16 {
		if hhh == 6 {
			self.regs.iisr
		} else {
			0
		}
	}

	fn set_hw_reg(&mut self, hhh: u16, v: u16) {
		if hhh == 6 {
			self.regs.iisr = v & 0xffff;
		}
	}

	fn fp_from_words(w0: u16, w1: u16) -> f64 {
		if (w0 | w1) == 0 {
			return 0.0;
		}
		let sign = (w0 >> 15) & 1;
		let exp = ((w0 >> 8) & 0x7f) as i32;
		let mant = (((w0 & 0xff) as u32) << 16) | (w1 as u32);
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
		let w0 = (sign << 15) | (((exp as u16) & 0x7f) << 8) | (((mant_u >> 16) as u16) & 0xff);
		let w1 = (mant_u & 0xffff) as u16;
		(w0, w1, false)
	}

	fn fp_decode(&self) -> f64 {
		Self::fp_from_words(self.regs.r[0], self.regs.r[1])
	}

	fn fp_encode(&mut self, v: f64) {
		let (w0, w1, ov) = Self::fp_to_words(v);
		self.regs.r[0] = w0;
		self.regs.r[1] = w1;
		self.set_ovf(ov);
	}

	fn fp_decode_at(&mut self, ram: &mut Mn1613Ram, ea: u16) -> f64 {
		let w0 = self.rd_c(ram, ea);
		let w1 = self.rd_c(ram, ea.wrapping_add(1));
		Self::fp_from_words(w0, w1)
	}

	fn fp_finish(&mut self, ram: &mut Mn1613Ram, kkkk: u16) {
		self.set_e(false);
		if self.skip_cond(kkkk, self.regs.r[0] | self.regs.r[1]) {
			self.skip_next(ram);
		}
	}

	fn lad_result(a: u16, b: u16) -> u16 {
		let mut res = 0u16;
		for shift in (0..16).step_by(4) {
			let na = (a >> shift) & 0xf;
			let nb = (b >> shift) & 0xf;
			res |= (if na + nb > 9 { 6 } else { 0 }) << shift;
		}
		res
	}

	fn dswp(v: u16) -> u16 {
		let lo4 = v & 0x000f;
		let nib1 = (v >> 4) & 0x000f;
		let nib2 = (v >> 8) & 0x000f;
		let hi4 = (v >> 12) & 0x000f;
		(hi4 << 12) | (nib1 << 8) | (nib2 << 4) | lo4
	}

	fn execute_one(&mut self, ram: &mut Mn1613Ram) {
		if self.pending_irq != 0 {
			self.handle_irq(ram);
		}
		if let Some(mut cb) = self.on_before.take() {
			cb(&self.regs, ram);
			self.on_before = Some(cb);
		}

		let ir = self.fetch(ram);
		let op = (ir >> 11) & 0x1f;
		let rrr = (ir >> 8) & 0x7;
		let lo = ir & 0xff;

		if op >= 0x10 {
			let mmm = op & 7;
			let ea = self.ea(ram, mmm, lo);
			let is_hi = (op & 8) != 0;
			if rrr == 7 {
				if is_hi {
					self.regs.ic = ea;
				} else {
					self.push(ram, self.regs.ic);
					self.regs.ic = ea;
				}
			} else if mmm == 7 {
				let cur = self.rd_c(ram, ea);
				let res = if is_hi {
					cur.wrapping_add(1)
				} else {
					cur.wrapping_sub(1)
				};
				self.wr_c(ram, ea, res);
				if res == 0 {
					self.skip_next(ram);
				}
			} else if is_hi {
				let v = self.rd_c(ram, ea);
				self.sw(rrr, v);
			} else {
				self.wr_c(ram, ea, self.gr(rrr));
			}
		} else {
			self.exec_low(ram, op, rrr, lo);
		}

		if let Some(mut cb) = self.on_after.take() {
			cb(&self.regs, ram);
			self.on_after = Some(cb);
		}
	}

	fn exec_low(&mut self, ram: &mut Mn1613Ram, op: u16, rrr: u16, lo: u16) {
		match op {
			0x00 => self.trap_undefined(ram),
			0x01 => self.exec_01(ram, rrr, lo),
			0x02 => self.exec_02(ram, rrr, lo),
			0x03 => self.exec_03(ram, rrr, lo),
			0x04 => self.exec_04(ram, rrr, lo),
			0x05 => {
				let kkkk = (lo >> 4) & 0xf;
				let bit_n = lo & 0xf;
				let mask = 1u16 << (15 - bit_n);
				if self.skip_cond(kkkk, self.gr(rrr) & mask) {
					self.skip_next(ram);
				}
			}
			0x06 => {
				let kkkk = (lo >> 4) & 0xf;
				let mask = 1u16 << (15 - (lo & 0xf));
				let res = self.gr(rrr) & !mask;
				self.sw(rrr, res);
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
			0x07 => self.exec_07(ram, rrr, lo),
			0x08 => self.exec_08(ram, rrr, lo),
			0x09 => self.exec_09(ram, rrr, lo),
			0x0a => self.exec_0a(ram, rrr, lo),
			0x0b => self.exec_0b(ram, rrr, lo),
			0x0c => self.exec_0c(ram, rrr, lo),
			0x0d => self.exec_0d(ram, rrr, lo),
			0x0e => self.exec_0e(ram, rrr, lo),
			0x0f => self.exec_0f(ram, rrr, lo),
			_ => self.trap_undefined(ram),
		}
	}

	fn exec_01(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		if rrr != 7 {
			self.sw(rrr, (self.gr(rrr) & 0xff00) | lo);
			return;
		}
		let bit7 = (lo >> 7) & 1;
		let b_bits = (lo >> 4) & 7;
		let bit3 = (lo >> 3) & 1;
		let b_lo = lo & 7;
		if b_lo == 7 {
			let ad16 = self.fetch(ram);
			if bit7 == 0 && bit3 == 0 {
				if b_bits != 0 {
					let v = self.rd_c(ram, ad16) & 0xf;
					self.set_seg_reg(b_bits, v);
				}
			} else if bit7 == 0 && bit3 == 1 {
				let v = self.rd_c(ram, ad16);
				self.set_spec_reg(b_bits, v);
			} else if bit7 == 1 && bit3 == 0 {
				self.wr_c(ram, ad16, self.get_seg_reg(b_bits));
			} else {
				self.wr_c(ram, ad16, self.get_spec_reg(b_bits));
			}
		} else if bit7 == 1 && bit3 == 0 {
			self.sw(b_lo, self.get_seg_reg(b_bits));
		} else if bit7 == 1 && bit3 == 1 {
			self.sw(b_lo, self.get_spec_reg(b_bits));
		} else if bit7 == 0 && bit3 == 0 {
			if b_bits != 0 {
				self.set_seg_reg(b_bits, self.gr(b_lo) & 0xf);
			}
		} else {
			self.set_spec_reg(b_bits, self.gr(b_lo));
		}
	}

	fn exec_02(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		if rrr != 7 {
			self.do_io_write(lo, self.gr(rrr));
		} else if lo == 0x0f {
			for i in 0..=4 {
				self.push(ram, self.regs.r[i]);
			}
		} else if lo == 0x07 {
			for i in (0..=4).rev() {
				self.regs.r[i] = self.pop(ram);
			}
		} else {
			let ad16 = self.fetch(ram);
			let kkkk = (lo >> 4) & 0xf;
			let sss = lo & 7;
			let mem = self.rd_c(ram, ad16);
			let rs = self.gr(sss);
			let test = mem & rs;
			let res = if (lo & 8) != 0 { mem | rs } else { mem & !rs };
			self.wr_c(ram, ad16, res);
			if self.skip_cond(kkkk, test) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_03(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		if rrr != 7 {
			let v = self.do_io_read(lo);
			self.sw(rrr, v);
			return;
		}
		let kkkk = (lo >> 4) & 0xf;
		let bit3 = (lo >> 3) & 1;
		let bit2 = (lo >> 2) & 1;
		if bit2 == 1 {
			if bit3 == 0 {
				let v = self.fp_decode().trunc();
				let ov = v > 32767.0 || v < -32768.0;
				self.set_e(false);
				self.set_ovf(ov);
				self.regs.r[0] = if ov { 0 } else { (v as i16) as u16 };
				if self.skip_cond(kkkk, self.regs.r[0]) {
					self.skip_next(ram);
				}
			} else {
				let s16 = self.regs.r[0] as i16;
				self.fp_encode(s16 as f64);
				self.set_e(false);
				if self.skip_cond(kkkk, self.regs.r[0] | self.regs.r[1]) {
					self.skip_next(ram);
				}
			}
		} else {
			let ddd = lo & 7;
			let carry = if bit3 == 0 {
				if (self.regs.str & STR_E) != 0 {
					1
				} else {
					0
				}
			} else {
				0
			};
			let r1 = self.sub16(0, self.gr(ddd));
			let r2 = self.sub16(r1, carry);
			self.sw(ddd, r2);
			if self.skip_cond(kkkk, r2) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_07(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		if rrr != 7 {
			let kkkk = (lo >> 4) & 0xf;
			let mask = 1u16 << (15 - (lo & 0xf));
			let res = self.gr(rrr) | mask;
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if lo == 0x07 {
			self.regs.csbr = (self.pop(ram) & 0xf) as u8;
			self.regs.ic = self.pop(ram);
		} else if lo == 0x17 {
			while self.regs.r[0] != 0 {
				let v = self.rd_b(ram, self.regs.r[1], self.regs.tsr0);
				self.wr_b(ram, self.regs.r[2], v, self.regs.tsr1);
				self.regs.r[1] = self.regs.r[1].wrapping_add(1);
				self.regs.r[2] = self.regs.r[2].wrapping_add(1);
				self.regs.r[0] = self.regs.r[0].wrapping_sub(1);
			}
		} else if (lo >> 4) == 0x7 && (lo & 8) == 0 {
			let sss = lo & 7;
			let mut v = self.gr(sss);
			let mut pos = 0x10u16;
			for b in (0..=15).rev() {
				if ((v >> b) & 1) != 0 {
					pos = 15 - b;
					v &= !(1 << b);
					break;
				}
			}
			self.regs.r[0] = pos;
			self.sw(sss, v);
		} else if (lo >> 4) == 0xf && (lo & 8) == 0 {
			let ddd2 = lo & 7;
			let res = self.gr(ddd2) | (1u16 << (15 - (self.regs.r[0] & 0xf)));
			self.sw(ddd2, res);
		} else {
			let bit7 = (lo >> 7) & 1;
			let hhh = (lo >> 4) & 7;
			let rd_src = lo & 7;
			if bit7 != 0 {
				self.sw(rd_src, self.get_hw_reg(hhh));
			} else {
				self.set_hw_reg(hhh, self.gr(rd_src));
			}
		}
	}

	fn exec_08(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		if rrr == 7 && (lo & 4) != 0 {
			let c = (lo >> 3) & 1;
			let ii = lo & 3;
			let ea = self.ri(ii);
			let mh = self.rd_c(ram, ea) as i64;
			let ml = self.rd_c(ram, ea.wrapping_add(1)) as i64;
			let e0 = if c == 0 && (self.regs.str & STR_E) != 0 {
				1i64
			} else {
				0
			};
			let d = (self.regs.r[0] as i64) * 65536 + (self.regs.r[1] as i64) - (mh * 65536 + ml) - e0;
			self.set_e(d < 0);
			self.set_ovf(false);
			let du = if d < 0 { d + 0x1_0000_0000 } else { d } as u64;
			self.regs.r[0] = ((du >> 16) & 0xffff) as u16;
			self.regs.r[1] = (du & 0xffff) as u16;
			if self.skip_cond(kkkk, self.regs.r[0] | self.regs.r[1]) {
				self.skip_next(ram);
			}
		} else {
			let dddd = lo & 0xf;
			let si_res = self.gr(rrr).wrapping_sub(dddd);
			self.sw(rrr, si_res);
			if self.skip_cond(kkkk, si_res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_09(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		if rrr == 7 && (lo & 4) != 0 {
			let c = (lo >> 3) & 1;
			let ii = lo & 3;
			let ea = self.ri(ii);
			let mh = self.rd_c(ram, ea) as u64;
			let ml = self.rd_c(ram, ea.wrapping_add(1)) as u64;
			let e0 = if c == 0 && (self.regs.str & STR_E) != 0 {
				1u64
			} else {
				0
			};
			let d = (self.regs.r[0] as u64) * 65536 + (self.regs.r[1] as u64) + (mh * 65536 + ml) + e0;
			self.set_e(d > 0xffff_ffff);
			self.set_ovf(false);
			let du = d as u32;
			self.regs.r[0] = ((du >> 16) & 0xffff) as u16;
			self.regs.r[1] = (du & 0xffff) as u16;
			if self.skip_cond(kkkk, self.regs.r[0] | self.regs.r[1]) {
				self.skip_next(ram);
			}
		} else {
			let ai_res = self.gr(rrr).wrapping_add(lo & 0xf);
			self.sw(rrr, ai_res);
			if self.skip_cond(kkkk, ai_res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_0a(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		let b32 = (lo >> 2) & 3;
		let b10 = lo & 3;
		let b3 = (lo >> 3) & 1;
		if rrr == 7 {
			if (lo & 4) != 0 {
				let c = b3;
				let ii = b10;
				let m = self.rd_c(ram, self.ri(ii));
				let e0 = if c == 0 && (self.regs.str & STR_E) != 0 {
					1i32
				} else {
					0
				};
				let mut res = (self.regs.r[0] as i32) - (m as i32) - e0;
				self.set_e(res < 0);
				if ((self.regs.r[0] & 0xf) as i32) - ((m & 0xf) as i32) - e0 < 0 {
					res -= 0x06;
				}
				if (((self.regs.r[0] >> 4) & 0xf) as i32) - (((m >> 4) & 0xf) as i32) < 0 {
					res -= 0x60;
				}
				self.regs.r[0] = res as u16;
				if self.skip_cond(kkkk, self.regs.r[0]) {
					self.skip_next(ram);
				}
			} else if b32 == 2 {
				let rhs = self.rd_c(ram, self.ri(b10));
				let res = self.sub16(self.regs.r[0], rhs);
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else {
				let rhs = self.rd_c(ram, self.ri(b10)) & 0xff;
				let res = self.sub16(self.regs.r[0] & 0xff, rhs);
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
		} else if b3 == 1 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.sub16(self.gr(rrr), imm);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 0 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.sub16(self.gr(rrr) & 0xff, imm & 0xff);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 1 {
			let res = self.sub16(self.gr(rrr), self.gr(lo & 7));
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else {
			let res = self.sub16(self.gr(rrr) & 0xff, self.gr(lo & 7) & 0xff);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_0b(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		let b32 = (lo >> 2) & 3;
		let b10 = lo & 3;
		let b3 = (lo >> 3) & 1;
		if rrr == 7 {
			if (lo & 4) != 0 {
				let c = b3;
				let ii = b10;
				let m = self.rd_c(ram, self.ri(ii));
				let e0 = if c == 0 && (self.regs.str & STR_E) != 0 {
					1u32
				} else {
					0
				};
				let mut res = (self.regs.r[0] as u32) + (m as u32) + e0;
				self.set_e(res > 0xffff);
				if ((self.regs.r[0] & 0xf) as u32) + ((m & 0xf) as u32) + e0 > 9 {
					res += 0x06;
				}
				if ((res >> 8) & 0xff) > 0x99 {
					res += 0x0600;
				}
				self.regs.r[0] = (res & 0xffff) as u16;
				if self.skip_cond(kkkk, self.regs.r[0]) {
					self.skip_next(ram);
				}
			} else if b32 == 2 {
				let rhs = self.rd_c(ram, self.ri(b10));
				let res = self.add16(self.regs.r[0], rhs);
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else if b32 == 0 {
				let rhs = self.rd_c(ram, self.ri(b10));
				let res = self.sub16(self.regs.r[0], rhs);
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else if b3 == 1 && (lo & 7) == 7 {
				let imm = self.fetch(ram);
				let res = self.add16(self.regs.ic, imm);
				self.regs.ic = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else {
				let imm = self.fetch(ram);
				let res = self.sub16(self.regs.ic, imm);
				self.regs.ic = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
		} else if b3 == 1 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.add16(self.gr(rrr), imm);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 0 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.sub16(self.gr(rrr), imm);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 1 {
			let res = self.add16(self.gr(rrr), self.gr(lo & 7));
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else {
			let res = self.sub16(self.gr(rrr), self.gr(lo & 7));
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_0c(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		let b32 = (lo >> 2) & 3;
		let b10 = lo & 3;
		let b3 = (lo >> 3) & 1;
		if rrr == 7 {
			if b32 == 3 {
				let rhs = self.fp_decode_at(ram, self.ri(b10));
				let lhs = self.fp_decode();
				self.fp_encode(lhs * rhs);
				self.fp_finish(ram, kkkk);
			} else if b32 == 1 {
				let me = self.fp_decode_at(ram, self.ri(b10));
				if me == 0.0 {
					self.set_ovf(true);
					self.set_e(false);
					if self.skip_cond(kkkk, self.regs.r[0] | self.regs.r[1]) {
						self.skip_next(ram);
					}
				} else {
					let lhs = self.fp_decode();
					self.fp_encode(lhs / me);
					self.fp_finish(ram, kkkk);
				}
			} else if b32 == 2 {
				let res = self.regs.r[0] | self.rd_c(ram, self.ri(b10));
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else {
				let res = self.regs.r[0] ^ self.rd_c(ram, self.ri(b10));
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
		} else if b3 == 1 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.gr(rrr) | imm;
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 0 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.gr(rrr) ^ imm;
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 1 {
			let res = self.gr(rrr) | self.gr(lo & 7);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else {
			let res = self.gr(rrr) ^ self.gr(lo & 7);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_0d(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		let b32 = (lo >> 2) & 3;
		let b10 = lo & 3;
		let b3 = (lo >> 3) & 1;
		if rrr == 7 {
			if b32 == 3 {
				let rhs = self.fp_decode_at(ram, self.ri(b10));
				let lhs = self.fp_decode();
				self.fp_encode(lhs + rhs);
				self.fp_finish(ram, kkkk);
			} else if b32 == 1 {
				let rhs = self.fp_decode_at(ram, self.ri(b10));
				let lhs = self.fp_decode();
				self.fp_encode(lhs - rhs);
				self.fp_finish(ram, kkkk);
			} else if b32 == 2 {
				let res = self.regs.r[0] & self.rd_c(ram, self.ri(b10));
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else {
				let m = self.rd_c(ram, self.ri(b10));
				let res = Self::lad_result(self.regs.r[0], m);
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
		} else if b3 == 1 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = self.gr(rrr) & imm;
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 0 && (lo & 7) == 7 {
			let imm = self.fetch(ram);
			let res = Self::lad_result(self.gr(rrr), imm);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else if b3 == 1 {
			let res = self.gr(rrr) & self.gr(lo & 7);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else {
			let res = Self::lad_result(self.gr(rrr), self.gr(lo & 7));
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_0e(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		let b32 = (lo >> 2) & 3;
		let b10 = lo & 3;
		let b3 = (lo >> 3) & 1;
		if rrr == 7 {
			if b32 == 3 {
				let div = self.rd_c(ram, self.ri(b10));
				self.set_e(false);
				if div == 0 {
					self.set_ovf(true);
					return;
				}
				let n32 = ((self.regs.r[0] as u32) << 16) | (self.regs.r[1] as u32);
				let q = n32 / (div as u32);
				let r = n32 % (div as u32);
				if q > 0xffff {
					self.set_ovf(true);
					return;
				}
				self.set_ovf(false);
				self.regs.r[0] = (q & 0xffff) as u16;
				self.regs.r[1] = (r & 0xffff) as u16;
				if self.skip_cond(kkkk, self.regs.r[0]) {
					self.skip_next(ram);
				}
			} else if b32 == 2 {
				let v = self.rd_c(ram, self.ri(b10));
				let res = ((v & 0xff) << 8) | (v >> 8);
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else {
				let res = Self::dswp(self.rd_c(ram, self.ri(b10)));
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
		} else if b3 == 1 {
			let v = self.gr(lo & 7);
			let res = ((v & 0xff) << 8) | (v >> 8);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else {
			let res = Self::dswp(self.gr(lo & 7));
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_0f(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let kkkk = (lo >> 4) & 0xf;
		let b32 = (lo >> 2) & 3;
		let b10 = lo & 3;
		let b3 = (lo >> 3) & 1;
		if rrr == 7 {
			if b32 == 3 {
				let p = (self.regs.r[0] as u32) * (self.rd_c(ram, self.ri(b10)) as u32);
				self.set_ovf(false);
				self.set_e(false);
				self.regs.r[0] = ((p >> 16) & 0xffff) as u16;
				self.regs.r[1] = (p & 0xffff) as u16;
				if self.skip_cond(kkkk, self.regs.r[0] | self.regs.r[1]) {
					self.skip_next(ram);
				}
			} else if b32 == 2 {
				let res = self.rd_c(ram, self.ri(b10));
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			} else if b3 == 0 && (lo & 7) == 7 {
				self.regs.ic = self.fetch(ram);
			} else {
				let res = (self.regs.r[0] & 0xff00) | (self.rd_c(ram, self.ri(b10)) & 0xff);
				self.regs.r[0] = res;
				if self.skip_cond(kkkk, res) {
					self.skip_next(ram);
				}
			}
		} else if (lo & 7) == 7 && b3 == 0 {
			let imm = self.fetch(ram);
			self.sw(rrr, imm);
			if self.skip_cond(kkkk, imm) {
				self.skip_next(ram);
			}
		} else if b3 == 1 {
			let res = self.gr(lo & 7);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		} else {
			let res = (self.gr(rrr) & 0xff00) | (self.gr(lo & 7) & 0xff);
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
		}
	}

	fn exec_04(&mut self, ram: &mut Mn1613Ram, rrr: u16, lo: u16) {
		let b32 = (lo >> 2) & 3;
		let b76 = (lo >> 6) & 3;
		let b54 = (lo >> 4) & 3;
		let b10 = lo & 3;
		let kkkk = (lo >> 4) & 0xf;
		let ee = b10;

		if rrr == 0 {
			if lo == 0x00 {
				self.exec_status = ExecStatus::Halted;
				return;
			}
			if lo == 0x03 {
				self.regs.ic = self.pop(ram);
				return;
			}
			if (0x04..=0x07).contains(&lo) {
				let ll = (lo & 3) as usize;
				self.regs.str = self.rd_phys(ram, phys((ll * 2) as u16, 0));
				self.regs.ic = self.rd_phys(ram, phys((ll * 2 + 1) as u16, 0));
				self.regs.csbr = self.regs.osr[ll] & 0xf;
				return;
			}
		}

		if rrr == 6 {
			if lo == 0x07 {
				self.regs.ic = self.fetch(ram);
				return;
			}
			if lo == 0x17 {
				let dest = self.fetch(ram);
				self.push(ram, self.regs.ic);
				self.regs.ic = dest;
				return;
			}
		}

		if rrr == 7 {
			if (lo & 0xfc) == 0x04 {
				self.exec_seg_branch(ram, b10, false);
				return;
			}
			if (lo & 0xfc) == 0x14 {
				self.exec_seg_branch(ram, b10, true);
				return;
			}
			if (lo & 0x08) != 0 {
				let bb = b54;
				let dest = lo & 7;
				let ad16 = self.fetch(ram);
				if (lo & 0x40) == 0 {
					if dest == 7 {
						if bb == 1 {
							self.push(ram, self.regs.ic);
							self.push(ram, self.regs.csbr as u16);
						}
						let nc = self.rd_b(ram, ad16, self.regs.csbr) & 0xf;
						let ni = self.rd_b(ram, ad16.wrapping_add(1), self.regs.csbr);
						self.regs.csbr = nc as u8;
						self.regs.ic = ni;
					} else {
						let v = self.rd_b(ram, ad16, self.seg(bb));
						self.sw(dest, v);
					}
				} else {
					self.wr_b(ram, ad16, self.gr(dest), self.seg(bb));
				}
				return;
			}
		}

		if lo == 0x01 {
			self.push(ram, self.gr(rrr));
			return;
		}
		if lo == 0x02 {
			let v = self.pop(ram);
			self.sw(rrr, v);
			return;
		}

		if b32 == 0 && b76 != 0 {
			let seg = self.seg(b54);
			let ea = if b76 == 1 {
				self.ri(b10)
			} else if b76 == 2 {
				self.ri_set(b10, self.ri(b10).wrapping_sub(1));
				self.ri(b10)
			} else {
				let ea = self.ri(b10);
				self.ri_set(b10, self.ri(b10).wrapping_add(1));
				ea
			};
			let v = self.rd_b(ram, ea, seg);
			self.sw(rrr, v);
			return;
		}

		if b32 == 1 && b76 != 0 {
			let seg = self.seg(b54);
			let ea = if b76 == 1 {
				self.ri(b10)
			} else if b76 == 2 {
				self.ri_set(b10, self.ri(b10).wrapping_sub(1));
				self.ri(b10)
			} else {
				let ea = self.ri(b10);
				self.ri_set(b10, self.ri(b10).wrapping_add(1));
				ea
			};
			self.wr_b(ram, ea, self.gr(rrr), seg);
			return;
		}

		if b32 == 2 {
			self.apply_ee(ee);
			let a = self.gr(rrr);
			let e_in = if (self.regs.str & STR_E) != 0 {
				0x8000
			} else {
				0
			};
			self.set_e((a & 1) != 0);
			let res = (a >> 1) | e_in;
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
			return;
		}

		if b32 == 3 {
			self.apply_ee(ee);
			let a = self.gr(rrr);
			let e_in = if (self.regs.str & STR_E) != 0 { 1 } else { 0 };
			self.set_e((a & 0x8000) != 0);
			let res = ((a << 1) | e_in) & 0xffff;
			self.sw(rrr, res);
			if self.skip_cond(kkkk, res) {
				self.skip_next(ram);
			}
			return;
		}

		if (lo >> 4) == 1 && b32 == 1 && rrr != 7 {
			let v = self.do_io_read(self.ri(b10));
			self.sw(rrr, v);
			return;
		}

		if (lo >> 4) == 1 && b32 == 0 {
			self.do_io_write(self.ri(b10), self.gr(rrr));
			return;
		}

		self.trap_undefined(ram);
	}

	fn exec_seg_branch(&mut self, ram: &mut Mn1613Ram, ii: u16, link: bool) {
		let base = self.ri(ii);
		if link {
			self.push(ram, self.regs.ic);
			self.push(ram, self.regs.csbr as u16);
		}
		let nc = self.rd_b(ram, base, self.regs.csbr) & 0xf;
		let ni = self.rd_b(ram, base.wrapping_add(1), self.regs.csbr);
		self.regs.csbr = nc as u8;
		self.regs.ic = ni;
	}
}

/// `set_state` 用の部分更新パッチ。
#[derive(Debug, Clone, Default)]
pub struct CpuRegisterPatch {
	pub r: Option<[Option<u16>; 5]>,
	pub osr: Option<[Option<u8>; 4]>,
	pub sp: Option<u16>,
	pub str: Option<u16>,
	pub ic: Option<u16>,
	pub csbr: Option<u8>,
	pub ssbr: Option<u8>,
	pub tsr0: Option<u8>,
	pub tsr1: Option<u8>,
	pub npp: Option<u8>,
	pub iisr: Option<u16>,
	pub sbrb: Option<u16>,
	pub icb: Option<u16>,
}

#[cfg(test)]
mod tests {
	use super::*;

	struct FixedIo {
		port0: u16,
	}

	impl IoCallbacks for FixedIo {
		fn io_read(&mut self, port: u16) -> u16 {
			if port == 0 {
				self.port0
			} else {
				0xffff
			}
		}
		fn io_write(&mut self, _port: u16, _val: u16) {}
	}

	fn setup_running(cpu: &mut Mn1613Core, ic: u16) {
		cpu.power_on_idle();
		cpu.set_state(&CpuRegisterPatch {
			ic: Some(ic),
			sp: Some(0xfffe),
			..Default::default()
		});
		cpu.set_exec_status(ExecStatus::Running);
	}

	#[test]
	fn l_st_h_basics() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new();
		// mem[0x40] = 0x1234
		ram.write_phys(0x40, 0x1234);
		// L R0, 0x40 ; ST R0, 0x50 ; H
		ram.load_words(0, &[0xc040, 0x8050, 0x2000]);

		setup_running(&mut cpu, 0);
		let st = cpu.run_slice(&mut ram, None, 16).expect("halt");
		assert_eq!(st, ExecStatus::Halted);
		assert_eq!(cpu.get_state().r[0], 0x1234);
		assert_eq!(ram.read_phys(0x50), 0x1234);
	}

	#[test]
	fn bald_and_ret() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new();
		// BALD dest ; H at return
		// 0: BALD 0x10  (0x2617, 0x0010)
		// 2: H
		// 0x10: AI R0,#1 ; RET
		ram.load_words(0, &[0x2617, 0x0010, 0x2000]);
		ram.load_words(0x10, &[0x4801, 0x2003]);

		setup_running(&mut cpu, 0);
		let st = cpu.run_slice(&mut ram, None, 32).expect("halt");
		assert_eq!(st, ExecStatus::Halted);
		assert_eq!(cpu.get_state().r[0], 1);
	}

	#[test]
	fn lpsw_level2() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new();
		// OPSW level2 at word 4/5
		ram.write_phys(4, 0x0100); // STR with M2
		ram.write_phys(5, 0x0020); // IC
		ram.write_phys(0x20, 0x2000); // H
																// OSR[2] kept as CSBR
		ram.load_words(0, &[0x2006]); // LPSW 2

		setup_running(&mut cpu, 0);
		cpu.set_state(&CpuRegisterPatch {
			osr: Some([None, None, Some(0), None]),
			csbr: Some(0),
			..Default::default()
		});
		let st = cpu.run_slice(&mut ram, None, 8).expect("halt");
		assert_eq!(st, ExecStatus::Halted);
		assert_eq!(cpu.get_state().str, 0x0100);
	}

	#[test]
	fn reset_loads_vector() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new();
		cpu.set_io_callbacks(Box::new(FixedIo { port0: 0x0108 }));
		ram.write_phys(0x010a, 0x00ff); // STR
		ram.write_phys(0x010b, 0x1800); // IC
		cpu.power_on_idle();
		cpu.reset(&ram);
		let s = cpu.get_state();
		assert_eq!(s.str, 0x00ff);
		assert_eq!(s.ic, 0x1800);
		assert_eq!(cpu.get_exec_status(), ExecStatus::Running);
	}

	#[test]
	fn soft_breakpoint() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new();
		ram.load_words(0, &[0x4801, 0x4801, 0x2000]); // AI; AI; H
		setup_running(&mut cpu, 0);
		cpu.add_breakpoint(1);
		cpu.tick(&mut ram); // exec first AI
		assert_eq!(cpu.get_state().r[0], 1);
		cpu.tick(&mut ram); // should break at IC=1
		assert_eq!(cpu.get_exec_status(), ExecStatus::Break);
		assert_eq!(cpu.get_state().r[0], 1);
	}

	#[test]
	fn multiply_m_instruction() {
		let mut cpu = Mn1613Core::new();
		let mut ram = Mn1613Ram::new();
		// M DR0,(R1): op=0x0f rrr=7 b32=3 ii=0 → lo = 0x0c ; then H
		ram.load_words(0, &[0x7f0c, 0x2000]);
		ram.write_phys(0x20, 3);
		setup_running(&mut cpu, 0);
		cpu.set_state(&CpuRegisterPatch {
			r: Some([Some(4), Some(0x20), None, None, None]),
			..Default::default()
		});
		let _ = cpu.run_slice(&mut ram, None, 8).expect("halt");
		let s = cpu.get_state();
		assert_eq!(s.r[0], 0);
		assert_eq!(s.r[1], 12);
	}

	#[test]
	fn dma_write_bytes_be() {
		let mut ram = Mn1613Ram::new();
		ram.dma_write_bytes(0, &[0x12, 0x34, 0x56, 0x78]);
		assert_eq!(ram.read_phys(0), 0x1234);
		assert_eq!(ram.read_phys(1), 0x5678);
	}

	#[test]
	fn phys_addressing() {
		assert_eq!(phys(0x0001, 0), 0x0001);
		assert_eq!(phys(0x0000, 0x4), 0x10000);
		assert_eq!(phys(0xffff, 0xc), 0x3ffff);
	}
}
