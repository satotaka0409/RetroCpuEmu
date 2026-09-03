pub mod calling_convention;
pub mod cdb;
pub mod cru_adapter;
pub mod cru_handshake;
pub mod cru_io_board_mock;
pub mod cru_io_control_sync;
pub mod disasm;
mod intel_hex;
pub mod session;
pub mod settings_session;
pub mod types;

pub use calling_convention::{
    plan_tms9995_call, validate_tms9995_arg_registers, TMS9995_DEFAULT_ARG_REGISTERS,
    TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS, TMS9995_DEFAULT_STACK_INIT, TMS9995_DEFAULT_WORKSPACE,
    TMS9995_MONITOR_ARG_REGISTERS,
};
pub use cdb::{empty_tms9995_cdb_table, parse_tms9995_cdb, require_tms9995_symbol};
pub use cru_adapter::{Tms9995CruHandshakeAdapter, Tms9995EmptyCruAdapter};
pub use cru_handshake::{
    Tms9995CruActor, Tms9995CruCpuInSignals, Tms9995CruCpuOutSignals,
    Tms9995CruHandshakeMock, Tms9995CruHandshakeOptions, Tms9995CruHandshakeRegion,
    Tms9995CruHandshakeSignals, Tms9995CruHandshakeSnapshot, TMS9995_CRU_HANDSHAKE_REGION,
    TMS9995_CRU_HANDSHAKE_SIGNALS,
};
pub use cru_io_board_mock::Tms9995CruIoBoardMock;
pub use cru_io_control_sync::Tms9995CruIoControlSync;
pub use session::{
    create_tms9995_artifact_session, Tms9995ArtifactSession, Tms9995AsmSession,
    Tms9995SessionOptions,
};
pub use settings_session::create_tms9995_session_from_settings;
pub use types::{
    CdbCheckpoint, CdbSymbol, CdbTable, Tms9995ArgLocation, Tms9995CallDiagnostics,
    Tms9995CallOptions, Tms9995CallPlan, Tms9995CallPlanOptions, Tms9995CallRegisters,
    Tms9995CallResult, Tms9995StackWord,
};
pub use disasm::{
    decode_tms9995, format_decoded, Tms9995Disassembler, Tms9995DisassemblerOptions,
    Tms9995LabelPair, Tms9995LabelTable,
};
