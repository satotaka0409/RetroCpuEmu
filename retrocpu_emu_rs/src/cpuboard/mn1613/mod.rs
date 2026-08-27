//! MN1613 CPU ボード周辺（比較器・ステップ）。コア本体は `cpu_core::mn1613`。

pub mod addr_comparator;
pub mod step_break;

pub use addr_comparator::{
	decode_break_ctrl, encode_break_ctrl, slot_matches, AddrBusAccess,
	AddrComparatorBank, AddrComparatorSlot, BREAK_RDWR_BOTH, BREAK_RDWR_RD,
	BREAK_RDWR_WR, CPLD_COMPARATOR_COUNT, IO_PORT_BREAK_ADDR_HI,
	IO_PORT_BREAK_ADDR_LO, IO_PORT_BREAK_CTRL, IO_PORT_BREAK_HIT,
	IO_PORT_BREAK_PREV,
};
pub use step_break::{
	StepBreakUnit, IO_PORT_STEP_DELAY, IO_PORT_STEP_ENA, STEP_BRK_DELAY_1STEP,
};
