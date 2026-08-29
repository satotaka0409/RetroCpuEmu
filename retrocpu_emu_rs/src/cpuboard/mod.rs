//! CPU ボード層の公開 API をまとめるモジュール。

pub mod board;
pub mod cpu_core;
pub mod dma;
pub mod handshake;
pub mod io_ports;
pub mod mn1613;

pub use board::{CpuBoard, CpuCoreHandle};
pub use dma::{CpuDma, DmaError, DmaWriteMemory, SharedRam, MN1613_PHYS_WORDS};
pub use handshake::{CpuHandshakeAgent, FrameLink, HandshakeTransport, HandshakeWires};
pub use io_ports::{
	IoPorts, PendingIrq, IO_PORT_RESET_VECTOR, MONITOR_ENTRY_WORD, RESET_VECTOR_IC_OFF,
	RESET_VECTOR_STR_OFF,
};
pub use mn1613::{AddrBusAccess, AddrComparatorBank, AddrComparatorSlot, StepBreakUnit};
