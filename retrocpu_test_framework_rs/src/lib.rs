pub mod assert;
pub mod assemble_link;
pub mod checkpoint;
pub mod cpu_log_mark;
pub mod error;
pub mod expand_includes;
pub mod framework;
pub mod handshake_mock;
pub mod hex_cdb;
pub mod json_suite;
pub mod json_value;
pub mod repo;
pub mod sdld_link;
pub use sdld_link::find_sdld;
pub mod types;
pub mod unit;

pub use assemble_link::{
    assemble_and_link, assemble_to_hex_cdb, default_hex_cdb_paths, lookup_byte_addr,
    lookup_word_addr, sources_have_main, HexCdbPaths,
};
pub use assert::{assert_contain_str, assert_contain_vec, assert_equal, assert_throw};
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
pub use framework::disasm::DisasmResult;
pub use framework::mn1613::{
    decode_mn1613, format_decoded as format_decoded_mn1613, hex16, hex8, Mn1613Disassembler,
    Mn1613DisassemblerOptions, Mn1613LabelPair, Mn1613LabelTable,
};
pub use framework::tms9995::{
    decode_tms9995, format_decoded as format_decoded_tms9995, Tms9995CruIoBoardMock,
    Tms9995CruIoControlSync, Tms9995Disassembler, Tms9995DisassemblerOptions,
    Tms9995LabelPair, Tms9995LabelTable,
};
pub use handshake_mock::{
    is_io_to_cpu_request_asserted, is_io_to_cpu_request_asserted_ports,
    with_framework_io_mock_defaults, BackgroundServe, BreakNotifyInfo, CodeTestIoMock,
    IoBoardHandshakeMock, TestIoCallbacks,
};
pub use hex_cdb::{defs_to_cdb, image_to_intel_hex};
pub use json_suite::{expand_placeholders, resolve_suite_path};
pub use json_value::{CodeTestIoMockEntry, JsonTestSettings};
pub use types::{AsmCpuType, AsmSource, AssembleLinkOptions, AssembleToFilesOptions, CpuLogMode, LinkedImage};
pub use unit::{expect, take_unit_tests, test, UnitCase};

// 後方互換: 旧モジュールパスを維持
pub use framework::mn1613 as mn1613;
pub use framework::tms9995 as tms9995;
pub use framework::mn1613::cdb::{
    empty_cdb_table, parse_cdb, require_symbol, CdbSymbol, CdbTable,
};
pub use mn1613::{
    clear_cpu_logs_before_run, create_mn1613_asm_session, create_session_from_settings,
    mn1613_logs_dir_from_test_file, CallOptions, CallRegisters, Mn1613AsmSession,
    Mn1613SessionOptions, RegisterExpect,
};
pub use retrocpu_emu_rs::cpuboard::{
    Mn1613CpuRegister, Mn1613CpuRegisterPatch, Mn1613ExecStatus,
};

/// 逆アセンブラ（CPU 別サブモジュール）。
pub mod disasm {
    pub use crate::framework::disasm::DisasmResult;
    pub use crate::framework::mn1613::disasm as mn1613;
    pub use crate::framework::tms9995::disasm as tms9995;
}
