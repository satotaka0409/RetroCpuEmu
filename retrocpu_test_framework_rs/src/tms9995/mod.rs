pub mod calling_convention;
pub mod cdb;
pub mod cru_handshake;
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
pub use cru_handshake::{
    Tms9995CruActor, Tms9995CruCpuInSignals, Tms9995CruCpuOutSignals,
    Tms9995CruHandshakeMock, Tms9995CruHandshakeOptions, Tms9995CruHandshakeRegion,
    Tms9995CruHandshakeSignals, Tms9995CruHandshakeSnapshot, TMS9995_CRU_HANDSHAKE_REGION,
    TMS9995_CRU_HANDSHAKE_SIGNALS,
};
pub use session::{create_tms9995_artifact_session, Tms9995ArtifactSession, Tms9995SessionOptions};
pub use settings_session::create_tms9995_session_from_settings;
pub use types::{
    CdbCheckpoint, CdbSymbol, CdbTable, Tms9995ArgLocation, Tms9995CallDiagnostics,
    Tms9995CallPlan, Tms9995CallPlanOptions, Tms9995StackWord,
};
