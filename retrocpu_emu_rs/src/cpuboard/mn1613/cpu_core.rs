//! MN1613 CPU コア関連の公開 API をまとめるモジュール。

mod bus;
mod core;
mod error;

pub use bus::{phys, Mn1613Ram, MEM_WORDS, PHYS_MASK};
pub use core::{
	CpuRegister, CpuRegisterPatch, ExecStatus, IoCallbacks, MemAccessEvent, Mn1613Core, NullIo,
	CPU_CLK_PER_ACCESS, IISR_UNDEF, STR_E, STR_M0, STR_M1, STR_M2, STR_OVF,
};
pub use error::Mn1613Error;
