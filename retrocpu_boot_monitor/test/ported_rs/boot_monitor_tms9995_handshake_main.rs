use std::path::PathBuf;

use retrocpu_test_framework_rs::json_value::JsonTestSettings;
use retrocpu_test_framework_rs::tms9995::{
    create_tms9995_session_from_settings, Tms9995CallOptions,
};
use retrocpu_test_framework_rs::types::{AsmCpuType, CpuLogMode};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn test_setting_json_path() -> PathBuf {
    repo_root().join("retrocpu_boot_monitor/test/test_setting.json")
}

fn load_monitor_paths(cpu_key: &str) -> (PathBuf, PathBuf, PathBuf) {
    let settings_path = test_setting_json_path();
    let json = std::fs::read_to_string(&settings_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", settings_path.display()));
    let root: serde_json::Value = serde_json::from_str(&json)
        .unwrap_or_else(|e| panic!("failed to parse {}: {e}", settings_path.display()));

    let ihx_rel = root
        .get(cpu_key)
        .and_then(|v| v.get("ihx"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("missing {}.ihx in {}", cpu_key, settings_path.display()));
    let cdb_rel = root
        .get(cpu_key)
        .and_then(|v| v.get("cdb"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("missing {}.cdb in {}", cpu_key, settings_path.display()));
    let log_rel = root
        .get(cpu_key)
        .and_then(|v| v.get("log"))
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("missing {}.log in {}", cpu_key, settings_path.display()));

    let monitor_root = repo_root().join("retrocpu_boot_monitor");
    (
        monitor_root.join(ihx_rel),
        monitor_root.join(cdb_rel),
        monitor_root.join(log_rel),
    )
}

fn load_artifact_paths(cpu_key: &str) -> (PathBuf, PathBuf) {
    let (ihx, cdb, _) = load_monitor_paths(cpu_key);
    (ihx, cdb)
}

fn tms9995_rs_settings() -> JsonTestSettings {
    let (hex_path, cdb_path, log_path) = load_monitor_paths("tms9995");
    let hex = hex_path.to_string_lossy().to_string();
    let cdb = cdb_path.to_string_lossy().to_string();
    let log = log_path.to_string_lossy().to_string();

    JsonTestSettings {
        name: "tms9995_mon_rs".to_string(),
        cpu: AsmCpuType::Tms9995,
        hex_file: hex,
        cdb_file: cdb,
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: Some(log),
        cpu_log_mode: Some(CpuLogMode::Checkpoint),
        max_cycles: None,
    }
}

fn monitor_artifact_exists() -> bool {
    let (hex, cdb) = load_artifact_paths("tms9995");
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
    F: FnOnce(&mut retrocpu_test_framework_rs::tms9995::Tms9995ArtifactSession),
{
    if !monitor_artifact_exists() {
        return;
    }
    let mut session = create_tms9995_session_from_settings(&tms9995_rs_settings(), None)
        .expect("create TMS9995 artifact session");
    f(&mut session);
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
fn run_init_reaches_idle() {
    with_session(|session| {
        session.run_init().expect("g_main should reach IDLE");
        assert!(session.core_state().idle);
    });
}

#[test]
fn call_entry_is_available() {
    with_session(|session| {
        let result = session.call(
            "g_handshake_interrupt_handler",
            Tms9995CallOptions::default(),
        );
        match result {
            Ok(_) => {}
            Err(err) => {
                let msg = format!("{err}");
                assert!(
                    !msg.contains("not implemented"),
                    "call should use CPU emu: {msg}"
                );
            }
        }
    });
}
