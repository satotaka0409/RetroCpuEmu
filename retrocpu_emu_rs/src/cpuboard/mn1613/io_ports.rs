//! MN1613 IO ポート関連の公開 API をまとめるモジュール。

mod constants;
mod ports;

pub use constants::{
	IO_PORT_RESET_VECTOR, MONITOR_ENTRY_WORD, RESET_VECTOR_IC_OFF, RESET_VECTOR_STR_OFF,
};
pub use ports::{IoPorts, PendingIrq};
