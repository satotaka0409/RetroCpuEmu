use std::path::PathBuf;

use retrocpu_test_framework_rs::json_value::JsonTestSettings;
use retrocpu_test_framework_rs::tms9995::create_tms9995_session_from_settings;
use retrocpu_test_framework_rs::types::{AsmCpuType, CpuLogMode};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn tms9995_rs_settings() -> JsonTestSettings {
    let root = repo_root();
    let hex = root
        .join("retrocpu_boot_monitor/build/hex_rs/tms9995/tms9995_mon_rs.ihx")
        .to_string_lossy()
        .to_string();
    let cdb = root
        .join("retrocpu_boot_monitor/build/hex_rs/tms9995/tms9995_mon_rs.cdb")
        .to_string_lossy()
        .to_string();

    JsonTestSettings {
        name: "tms9995_mon_rs".to_string(),
        cpu: AsmCpuType::Tms9995,
        hex_file: hex,
        cdb_file: cdb,
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: None,
        cpu_log_mode: Some(CpuLogMode::Checkpoint),
        max_cycles: None,
    }
}

fn monitor_artifact_exists() -> bool {
    let root = repo_root();
    let hex = root.join("retrocpu_boot_monitor/build/hex_rs/tms9995/tms9995_mon_rs.ihx");
    let cdb = root.join("retrocpu_boot_monitor/build/hex_rs/tms9995/tms9995_mon_rs.cdb");
    if !hex.is_file() || !cdb.is_file() {
        eprintln!(
            "skip: missing monitor artifact: {} / {}",
            hex.display(),
            cdb.display()
        );
        return false;
    }
    true
}

fn with_session<F>(f: F)
where
    F: FnOnce(&retrocpu_test_framework_rs::tms9995::Tms9995ArtifactSession),
{
    if !monitor_artifact_exists() {
        return;
    }
    let session = create_tms9995_session_from_settings(&tms9995_rs_settings(), None)
        .expect("create TMS9995 artifact session");
    f(&session);
}

#[test]
fn public_symbol_exists_in_cdb() {
    with_session(|session| {
        let addr = session
            .require_byte_addr("g_handshake_interrupt_handler")
            .expect("required symbol");
        assert!(addr > 0);
    });
}

#[test]
fn cmd_lt_0x10_placeholder_until_cpu_emu() {
    with_session(|session| {
        let err = session
            .call("g_handshake_interrupt_handler")
            .expect_err("call must fail");
        assert!(format!("{err}").contains("CPU emu"));
    });
}

#[test]
fn unknown_cmd_placeholder_until_cpu_emu() {
    with_session(|session| {
        let err = session
            .call("g_handshake_interrupt_handler")
            .expect_err("call must fail");
        assert!(format!("{err}").contains("CPU emu"));
    });
}

#[test]
fn exec_cmd_placeholder_until_cpu_emu() {
    with_session(|session| {
        let err = session
            .call("g_handshake_interrupt_handler")
            .expect_err("call must fail");
        assert!(format!("{err}").contains("CPU emu"));
    });
}

#[test]
fn removed_cpu_state_cmd_placeholder_until_cpu_emu() {
    with_session(|session| {
        let err = session
            .call("g_handshake_interrupt_handler")
            .expect_err("call must fail");
        assert!(format!("{err}").contains("CPU emu"));
    });
}
