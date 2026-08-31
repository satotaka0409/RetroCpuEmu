//! MN1613 用アドレス比較器モジュール。

pub mod addr_comparator;

pub use addr_comparator::{
	decode_break_ctrl, encode_break_ctrl, slot_matches, AddrBusAccess, AddrComparatorBank,
	AddrComparatorSlot, BREAK_RDWR_BOTH, BREAK_RDWR_RD, BREAK_RDWR_WR, CPLD_COMPARATOR_COUNT,
	IO_PORT_BREAK_ADDR_HI, IO_PORT_BREAK_ADDR_LO, IO_PORT_BREAK_CTRL, IO_PORT_BREAK_HIT,
	IO_PORT_BREAK_PREV,
};
