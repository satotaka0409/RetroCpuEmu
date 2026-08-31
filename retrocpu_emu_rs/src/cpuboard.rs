//! CPU ボード層の公開 API をまとめるモジュール。

pub mod board;
pub mod mn1613 {
	pub mod addr_comp;
	pub mod cpu_core;
	pub mod dma;
	pub mod handshake;
	pub mod io_ports;
	pub mod step_run;
}
pub mod tms9995 {
	pub mod addr_comp;
	pub mod cpu_core;
	pub mod dma;
	pub mod handshake;
	pub mod io_ports;
	pub mod step_run;
}

// CPU 非依存の共通ボード API。
pub use board::{CpuBoard, CpuCoreHandle};

// MN1613: アドレス比較器まわりの公開型。
pub use mn1613::addr_comp::{
	AddrBusAccess as Mn1613AddrBusAccess, AddrComparatorBank as Mn1613AddrComparatorBank,
	AddrComparatorSlot as Mn1613AddrComparatorSlot,
};
// MN1613: CPU コア本体・実行状態・レジスタ関連。
pub use mn1613::cpu_core::{
	CpuRegister as Mn1613CpuRegister, CpuRegisterPatch as Mn1613CpuRegisterPatch,
	ExecStatus as Mn1613ExecStatus, IoCallbacks as Mn1613IoCallbacks,
	MemAccessEvent as Mn1613MemAccessEvent, Mn1613Core, Mn1613Error, Mn1613Ram,
	NullIo as Mn1613NullIo, CPU_CLK_PER_ACCESS, IISR_UNDEF, MEM_WORDS, PHYS_MASK, STR_E, STR_M0,
	STR_M1, STR_M2, STR_OVF,
};
// MN1613: DMA エミュレーション関連。
pub use mn1613::dma::{
	CpuDma as Mn1613CpuDma, DmaError as Mn1613DmaError, DmaWriteMemory as Mn1613DmaWriteMemory,
	SharedRam as Mn1613SharedRam, MN1613_PHYS_WORDS,
};
// MN1613: デバイス連携ハンドシェイク関連。
pub use mn1613::handshake::{
	CpuHandshakeAgent as Mn1613CpuHandshakeAgent, FrameLink as Mn1613FrameLink,
	HandshakeTransport as Mn1613HandshakeTransport, HandshakeWires as Mn1613HandshakeWires,
};
// MN1613: I/O ポートとリセットベクタ定数。
pub use mn1613::io_ports::{
	IoPorts as Mn1613IoPorts, PendingIrq as Mn1613PendingIrq,
	IO_PORT_RESET_VECTOR as MN1613_IO_PORT_RESET_VECTOR,
	MONITOR_ENTRY_WORD as MN1613_MONITOR_ENTRY_WORD,
	RESET_VECTOR_IC_OFF as MN1613_RESET_VECTOR_IC_OFF,
	RESET_VECTOR_STR_OFF as MN1613_RESET_VECTOR_STR_OFF,
};
// MN1613: ステップ実行時のブレーク制御ユニット。
pub use mn1613::step_run::StepBreakUnit as Mn1613StepBreakUnit;

// TMS9995: アドレス比較器まわりの公開型。
pub use tms9995::addr_comp::{
	AddrBusAccess as Tms9995AddrBusAccess, AddrComparatorBank as Tms9995AddrComparatorBank,
	AddrComparatorSlot as Tms9995AddrComparatorSlot,
};
// TMS9995: CPU コア本体と実行結果・状態。
pub use tms9995::cpu_core::{
	StepResult as Tms9995StepResult, Tms9995Bus, Tms9995Core, Tms9995Cru, Tms9995CruBus, Tms9995Ram,
	Tms9995State,
};
// TMS9995: DMA エミュレーション関連。
pub use tms9995::dma::{
	CpuDma as Tms9995CpuDma, DmaError as Tms9995DmaError, DmaWriteMemory as Tms9995DmaWriteMemory,
	SharedRam as Tms9995SharedRam, TMS9995_PHYS_BYTES,
};
// TMS9995: デバイス連携ハンドシェイク関連。
pub use tms9995::handshake::{
	CpuHandshakeAgent as Tms9995CpuHandshakeAgent, FrameLink as Tms9995FrameLink,
	HandshakeTransport as Tms9995HandshakeTransport, HandshakeWires as Tms9995HandshakeWires,
};
// TMS9995: I/O ポートとリセットベクタ定数。
pub use tms9995::io_ports::{IoPorts as Tms9995IoPorts, PendingIrq as Tms9995PendingIrq};
// TMS9995: ステップ実行時のブレーク制御ユニット。
pub use tms9995::step_run::StepBreakUnit as Tms9995StepBreakUnit;
