//! TMS9995 DMA 関連の公開 API をまとめるモジュール。

mod controller;
mod error;
mod memory;

pub use controller::CpuDma;
pub use error::DmaError;
pub use memory::{DmaWriteMemory, SharedRam, TMS9995_PHYS_BYTES};
