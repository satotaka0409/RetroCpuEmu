//! MN1613 DMA 関連の公開 API をまとめるモジュール。

mod controller;
mod error;
mod memory;

pub use controller::CpuDma;
pub use error::DmaError;
pub use memory::{DmaWriteMemory, SharedRam, MN1613_PHYS_WORDS};
