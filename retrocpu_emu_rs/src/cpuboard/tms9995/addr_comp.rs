//! TMS9995 用アドレス比較器モジュール。
//!
//! TMS9995 側は 16bit アドレス空間を前提とする。
//! そのため `IO_PORT_BREAK_ADDR_HI` (0x0032) は予約扱いで、
//! read は 0、write は無視される。

pub mod addr_comparator;

pub use addr_comparator::{
	decode_break_ctrl, encode_break_ctrl, slot_matches, AddrBusAccess, AddrComparatorBank,
	AddrComparatorSlot, BREAK_RDWR_BOTH, BREAK_RDWR_RD, BREAK_RDWR_WR, CPLD_COMPARATOR_COUNT,
	IO_PORT_BREAK_ADDR_HI, IO_PORT_BREAK_ADDR_LO, IO_PORT_BREAK_CTRL, IO_PORT_BREAK_HIT,
	IO_PORT_BREAK_PREV,
};
