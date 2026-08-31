//! CPU ボード CPLD 相当のアドレス比較器（4 本）
//! 根拠: MN1613_CPUボードメモリ_IOマップ.mdc / HandShake.mdc
//!
//! 一致時は呼び出し側が INT1・INT1_CAUSE=0 を上げる。

/// 比較器本数（ユーザ 0–3。ステップは比較器を使わない）
pub const CPLD_COMPARATOR_COUNT: usize = 4;

/// IO:0030 — スロット選択と ENA / MEM·IO / RD·WR
pub const IO_PORT_BREAK_CTRL: u16 = 0x0030;
/// IO:0031 — アドレス bit0–15（TS 準拠。IO マップ表とは上下逆）
pub const IO_PORT_BREAK_ADDR_LO: u16 = 0x0031;
/// IO:0032 — アドレス bit16–17（下位 2bit）
pub const IO_PORT_BREAK_ADDR_HI: u16 = 0x0032;
/// IO:0033 — 直近に一致した比較器番号（CPU 読取）
pub const IO_PORT_BREAK_HIT: u16 = 0x0033;
/// IO:0034 — ヒットしたスロットの前回書き込み値
pub const IO_PORT_BREAK_PREV: u16 = 0x0034;

/// Bit5–6: READ のみ
pub const BREAK_RDWR_RD: u8 = 0b01;
/// Bit5–6: WRITE のみ
pub const BREAK_RDWR_WR: u8 = 0b10;
/// Bit5–6: READ/WRITE 両方
pub const BREAK_RDWR_BOTH: u8 = 0b11;

/// 比較器 1 スロットの設定
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AddrComparatorSlot {
	/// 有効なら true
	pub enabled: bool,
	/// true=IO、false=MEM
	pub io: bool,
	/// Bit5–6 の値（01/10/11）。00 はアクセス種別不一致
	pub rdwr: u8,
	/// 監視する 18bit 物理ワードアドレス（MEM）または IO ポート下位
	pub addr: u32,
}

/// バスアクセス 1 回分（probe 入力）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AddrBusAccess {
	/// MEM なら 18bit 物理ワード、IO ならポート番号
	pub addr: u32,
	/// true=IO 空間
	pub io: bool,
	/// true=WRITE、false=READ
	pub write: bool,
	/// WRITE 時の書込後値（AFTER）。未使用可
	pub data: Option<u16>,
	/// WRITE 時の書込前値（BEFORE）。省略時は 0
	pub prev: Option<u16>,
}

impl AddrBusAccess {
	/// MEM/IO リードアクセスを作る。
	///
	/// # Arguments
	/// - `addr`: 18bit 物理ワードまたは IO ポート
	/// - `io`: `true` なら IO 空間
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn read(addr: u32, io: bool) -> Self {
		Self {
			addr,
			io,
			write: false,
			data: None,
			prev: None,
		}
	}

	/// MEM/IO ライトアクセスを作る。
	///
	/// # Arguments
	/// - `addr`: 18bit 物理ワードまたは IO ポート
	/// - `io`: `true` なら IO 空間
	/// - `after`: 書込後値
	/// - `before`: 書込前値
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn write(addr: u32, io: bool, after: u16, before: u16) -> Self {
		Self {
			addr,
			io,
			write: true,
			data: Some(after),
			prev: Some(before),
		}
	}
}

/// 制御ワード（IO:0030）からスロット設定を取り出す。
///
/// # Arguments
/// - `ctrl`: 16bit 制御値
///
/// # Returns
/// - `(u8, bool, bool, u8)` を返します。
pub fn decode_break_ctrl(ctrl: u16) -> (u8, bool, bool, u8) {
	let slot = (ctrl & 0x07) as u8;
	let enabled = ((ctrl >> 3) & 1) == 1;
	let io = ((ctrl >> 4) & 1) == 1;
	let rdwr = ((ctrl >> 5) & 0x03) as u8;
	(slot, enabled, io, rdwr)
}

/// スロット設定を IO:0030 用の制御ワードにする。
///
/// # Arguments
/// - `slot`: 比較器番号 0-3
/// - `enabled`: ENABLE
/// - `io`: `true` なら IO
/// - `rdwr`: 01/10/11
///
/// # Returns
/// - 16bit 値を返します。
pub fn encode_break_ctrl(slot: u8, enabled: bool, io: bool, rdwr: u8) -> u16 {
	(u16::from(slot) & 0x07)
		| (u16::from(enabled) << 3)
		| (u16::from(io) << 4)
		| ((u16::from(rdwr) & 0x03) << 5)
}

/// アクセスがスロット設定に一致するか。
///
/// # Arguments
/// - `slot`: スロット設定
/// - `access`: バスアクセス
///
/// # Returns
/// - 条件成立時は `true`、それ以外は `false` を返します。
pub fn slot_matches(slot: &AddrComparatorSlot, access: &AddrBusAccess) -> bool {
	if !slot.enabled {
		return false;
	}
	if slot.io != access.io {
		return false;
	}
	let rdwr = slot.rdwr & 0x03;
	if rdwr == 0 {
		return false;
	}
	if access.write {
		if (rdwr & BREAK_RDWR_WR) == 0 {
			return false;
		}
	} else if (rdwr & BREAK_RDWR_RD) == 0 {
		return false;
	}
	if access.io {
		(slot.addr & 0xffff) == (access.addr & 0xffff)
	} else {
		(slot.addr & 0x3_ffff) == (access.addr & 0x3_ffff)
	}
}

/// 4 本のアドレス比較器。IO 0030–0034 で設定・取得する。
#[derive(Debug, Clone)]
pub struct AddrComparatorBank {
	slots: [AddrComparatorSlot; CPLD_COMPARATOR_COUNT],
	ctrl_latch: u16,
	addr_lo_latch: u16,
	addr_hi_latch: u16,
	/// 直近ヒットしたスロット。無しは 0xFFFF
	last_hit: u16,
	prev_write: [u16; CPLD_COMPARATOR_COUNT],
	prev_latch: u16,
}

impl Default for AddrComparatorBank {
	fn default() -> Self {
		Self::new()
	}
}

impl AddrComparatorBank {
	/// 4 スロットを無効で初期化する。
	///
	/// # Returns
	/// - 初期化済みインスタンスを返します。
	pub fn new() -> Self {
		Self {
			slots: [AddrComparatorSlot::default(); CPLD_COMPARATOR_COUNT],
			ctrl_latch: 0,
			addr_lo_latch: 0,
			addr_hi_latch: 0,
			last_hit: 0xffff,
			prev_write: [0; CPLD_COMPARATOR_COUNT],
			prev_latch: 0,
		}
	}

	/// 全スロットを無効化しラッチをクリアする。
	pub fn reset(&mut self) {
		for s in &mut self.slots {
			*s = AddrComparatorSlot::default();
		}
		self.ctrl_latch = 0;
		self.addr_lo_latch = 0;
		self.addr_hi_latch = 0;
		self.last_hit = 0xffff;
		self.prev_latch = 0;
		self.prev_write = [0; CPLD_COMPARATOR_COUNT];
	}

	/// スロット内容を返す（コピー）。範囲外は None。
	///
	/// # Arguments
	/// - `slot`: 0-3
	///
	/// # Returns
	/// - 範囲内なら `Some(slot)`、範囲外なら `None` を返します。
	pub fn get_slot(&self, slot: usize) -> Option<AddrComparatorSlot> {
		self.slots.get(slot).copied()
	}

	/// スロットを直接設定する（テスト／内部用）。
	///
	/// # Arguments
	/// - `slot`: 0-3
	/// - `cfg`: 設定
	pub fn set_slot(&mut self, slot: usize, cfg: AddrComparatorSlot) {
		if let Some(s) = self.slots.get_mut(slot) {
			*s = AddrComparatorSlot {
				enabled: cfg.enabled,
				io: cfg.io,
				rdwr: cfg.rdwr & 0x03,
				addr: cfg.addr & 0x3_ffff,
			};
		}
	}

	/// 直近に一致した比較器番号を返す。未ヒットは 0xFFFF。
	///
	/// # Returns
	/// - 16bit 値を返します。
	pub fn last_hit(&self) -> u16 {
		self.last_hit
	}

	/// バスアクセスを全スロットと照合する。最初に一致したスロットでヒットする。
	///
	/// # Arguments
	/// - `access`: MEM/IO・RD/WR
	///
	/// # Returns
	/// - ヒットしたスロット番号。ヒットなしなら `None`。
	pub fn probe(&mut self, access: &AddrBusAccess) -> Option<usize> {
		for i in 0..CPLD_COMPARATOR_COUNT {
			if slot_matches(&self.slots[i], access) {
				if access.write {
					let before = access.prev.unwrap_or(0) & 0xffff;
					self.prev_write[i] = before;
					self.prev_latch = before;
				} else {
					self.prev_latch = 0;
				}
				self.last_hit = i as u16;
				return Some(i);
			}
		}
		None
	}

	/// IO リード（0030–0034）。対象外は None。
	///
	/// # Arguments
	/// - `port`: ポート番号
	///
	/// # Returns
	/// - 値が存在すれば `Some(value)`、なければ `None` を返します。
	pub fn read_port(&mut self, port: u16) -> Option<u16> {
		match port & 0xffff {
			IO_PORT_BREAK_CTRL => Some(self.ctrl_from_selected()),
			IO_PORT_BREAK_ADDR_LO => Some(self.addr_lo_from_selected()),
			IO_PORT_BREAK_ADDR_HI => Some(self.addr_hi_from_selected()),
			IO_PORT_BREAK_HIT => {
				if self.last_hit == 0xffff {
					self.prev_latch = 0;
					Some(0xffff)
				} else {
					let slot = (self.last_hit & 0x07) as usize;
					self.prev_latch = self.prev_write[slot] & 0xffff;
					Some(slot as u16)
				}
			}
			IO_PORT_BREAK_PREV => Some(self.prev_latch & 0xffff),
			_ => None,
		}
	}

	/// IO ライト（0030–0032）。0030 書込でスロットへ適用する。
	///
	/// # Arguments
	/// - `port`: ポート番号
	/// - `val`: 16bit 値
	///
	/// # Returns
	/// - 対応ポートを処理した場合は `true`。
	pub fn write_port(&mut self, port: u16, val: u16) -> bool {
		let p = port & 0xffff;
		let v = val & 0xffff;
		match p {
			IO_PORT_BREAK_ADDR_LO => {
				self.addr_lo_latch = v;
				self.apply_addr_to_selected();
				true
			}
			IO_PORT_BREAK_ADDR_HI => {
				self.addr_hi_latch = v & 0x03;
				self.apply_addr_to_selected();
				true
			}
			IO_PORT_BREAK_CTRL => {
				self.ctrl_latch = v;
				self.apply_ctrl_to_slot();
				true
			}
			IO_PORT_BREAK_HIT | IO_PORT_BREAK_PREV => true,
			_ => false,
		}
	}

	fn selected_slot(&self) -> usize {
		(self.ctrl_latch & 0x07) as usize
	}

	fn apply_ctrl_to_slot(&mut self) {
		let (slot, enabled, io, rdwr) = decode_break_ctrl(self.ctrl_latch);
		let slot = slot as usize;
		if slot >= CPLD_COMPARATOR_COUNT {
			return;
		}
		let s = &mut self.slots[slot];
		s.enabled = enabled;
		s.io = io;
		s.rdwr = rdwr;
		s.addr = ((u32::from(self.addr_hi_latch) & 0x03) << 16)
			| u32::from(self.addr_lo_latch);
	}

	fn apply_addr_to_selected(&mut self) {
		let slot = self.selected_slot();
		if slot >= CPLD_COMPARATOR_COUNT {
			return;
		}
		self.slots[slot].addr = ((u32::from(self.addr_hi_latch) & 0x03) << 16)
			| u32::from(self.addr_lo_latch);
	}

	fn ctrl_from_selected(&self) -> u16 {
		let slot = self.selected_slot();
		let s = &self.slots[slot.min(CPLD_COMPARATOR_COUNT - 1)];
		encode_break_ctrl(slot as u8, s.enabled, s.io, s.rdwr)
	}

	fn addr_lo_from_selected(&self) -> u16 {
		let slot = self.selected_slot().min(CPLD_COMPARATOR_COUNT - 1);
		(self.slots[slot].addr & 0xffff) as u16
	}

	fn addr_hi_from_selected(&self) -> u16 {
		let slot = self.selected_slot().min(CPLD_COMPARATOR_COUNT - 1);
		((self.slots[slot].addr >> 16) & 0x03) as u16
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn probe_hits_enabled_mem_read() {
		let mut bank = AddrComparatorBank::new();
		bank.set_slot(
			0,
			AddrComparatorSlot {
				enabled: true,
				io: false,
				rdwr: BREAK_RDWR_RD,
				addr: 0x1234,
			},
		);
		assert_eq!(bank.probe(&AddrBusAccess::read(0x1234, false)), Some(0));
		assert_eq!(bank.last_hit(), 0);
	}

	#[test]
	fn write_prev_latched_via_hit_port() {
		let mut bank = AddrComparatorBank::new();
		bank.set_slot(
			1,
			AddrComparatorSlot {
				enabled: true,
				io: false,
				rdwr: BREAK_RDWR_WR,
				addr: 0x10,
			},
		);
		assert_eq!(
			bank.probe(&AddrBusAccess::write(0x10, false, 0x2222, 0x1111)),
			Some(1)
		);
		assert_eq!(bank.read_port(IO_PORT_BREAK_HIT), Some(1));
		assert_eq!(bank.read_port(IO_PORT_BREAK_PREV), Some(0x1111));
	}

	#[test]
	fn ctrl_port_programs_slot() {
		let mut bank = AddrComparatorBank::new();
		bank.write_port(IO_PORT_BREAK_ADDR_LO, 0xABCD);
		bank.write_port(IO_PORT_BREAK_ADDR_HI, 0x02);
		bank.write_port(
			IO_PORT_BREAK_CTRL,
			encode_break_ctrl(2, true, false, BREAK_RDWR_BOTH),
		);
		let s = bank.get_slot(2).unwrap();
		assert!(s.enabled);
		assert_eq!(s.addr, 0x2_abcd);
		assert_eq!(s.rdwr, BREAK_RDWR_BOTH);
	}
}
