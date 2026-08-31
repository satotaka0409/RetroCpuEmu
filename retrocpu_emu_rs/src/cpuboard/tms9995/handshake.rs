//! TMS9995 用ハンドシェイク線・同一プロセス転送・CPU 側エージェントスタブ。
//! 実機 CRU 配線の詳細は後続で差し替える。

pub mod agent;
pub mod board_link;
pub mod wires;

pub use agent::CpuHandshakeAgent;
pub use board_link::{FrameLink, HandshakeTransport};
pub use wires::{
	encode_int1_cause, encode_int2_cause, HandshakeWires, INT1_CAUSE_ADDR_BREAK, INT1_CAUSE_STEP,
	INT2_CAUSE_HANDSHAKE, INT2_CAUSE_TIMER, IO_PORT_HSHK_IN_CTRL, IO_PORT_HSHK_IN_DATA,
	IO_PORT_HSHK_OUT_CTRL, IO_PORT_HSHK_OUT_DATA, IO_PORT_INTERRUPT_BUSY, IO_PORT_INT_CAUSE,
};
