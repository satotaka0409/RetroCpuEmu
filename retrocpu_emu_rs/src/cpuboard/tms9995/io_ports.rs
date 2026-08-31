//! TMS9995 IO ポート関連の公開 API をまとめるモジュール。

mod constants;
mod ports;

pub use constants::RESET_VECTOR;
pub use ports::{IoPorts, PendingIrq};
