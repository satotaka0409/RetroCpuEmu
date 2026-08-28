pub mod assert;
pub mod assemble_link;
pub mod cdb;
pub mod checkpoint;
pub mod cpu_log_mark;
pub mod error;
pub mod expand_includes;
pub mod handshake_mock;
pub mod hex_cdb;
pub mod json_suite;
pub mod json_value;
pub mod mn1613;
pub mod repo;
pub mod sdld_link;
pub use sdld_link::find_sdld;
pub mod tms9995;
pub mod types;
pub mod unit;

pub use assemble_link::{
    assemble_and_link, assemble_to_hex_cdb, default_hex_cdb_paths, lookup_byte_addr,
    lookup_word_addr, sources_have_main, HexCdbPaths,
};
pub use assert::{assert_contain_str, assert_contain_vec, assert_equal, assert_throw};
pub use cdb::{empty_cdb_table, parse_cdb, require_symbol, CdbSymbol, CdbTable};
pub use checkpoint::{
    checkpoint_id, checkpoints_to_cdb, create_checkpoint_state, inject_checkpoints,
    is_synthetic_checkpoint_global, CheckpointEmit, CheckpointInjectState,
};
pub use cpu_log_mark::{
    begin_cpu_log_test, clear_cpu_log_test_mark, end_cpu_log_test, set_active_cpu_log_marker,
    take_pending_cpu_log_test_name, CpuLogMarker, CpuLogTestPhase,
};
pub use error::FrameworkError;
pub use expand_includes::{expand_includes, expand_includes_from_file};
pub use handshake_mock::{
    is_io_to_cpu_request_asserted, is_io_to_cpu_request_asserted_ports,
    with_framework_io_mock_defaults, CodeTestIoMock, IoBoardHandshakeMock, TestIoCallbacks,
};
pub use hex_cdb::{defs_to_cdb, image_to_intel_hex};
pub use json_suite::{expand_placeholders, resolve_suite_path};
pub use json_value::{CodeTestIoMockEntry, JsonTestSettings};
pub use types::{AsmCpuType, AsmSource, AssembleLinkOptions, AssembleToFilesOptions, CpuLogMode, LinkedImage};
pub use mn1613::{
    clear_cpu_logs_before_run, create_mn1613_asm_session, mn1613_logs_dir_from_test_file,
    CallOptions, CallRegisters, Mn1613AsmSession, Mn1613SessionOptions, RegisterExpect,
};
pub use unit::{expect, take_unit_tests, test, UnitCase};
