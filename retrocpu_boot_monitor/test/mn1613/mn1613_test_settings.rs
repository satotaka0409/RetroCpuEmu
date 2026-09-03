use std::path::{Path, PathBuf};

use retrocpu_test_framework_rs::{AsmCpuType, JsonTestSettings};

pub(super) fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("canonicalize repo root")
}

fn test_setting_json_path() -> PathBuf {
    repo_root().join("retrocpu_boot_monitor/test/test_setting.json")
}

pub(super) fn load_monitor_paths(cpu_key: &str) -> (PathBuf, PathBuf, PathBuf) {
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

pub(super) fn load_artifact_paths(cpu_key: &str) -> (PathBuf, PathBuf) {
    let (ihx, cdb, _) = load_monitor_paths(cpu_key);
    (ihx, cdb)
}

pub(super) fn mn1613_artifact_paths() -> (PathBuf, PathBuf) {
    load_artifact_paths("mn1613")
}

pub(super) fn mn1613_monitor_paths() -> (PathBuf, PathBuf, PathBuf) {
    load_monitor_paths("mn1613")
}

pub(super) fn mn1613_rs_settings() -> JsonTestSettings {
    let (hex_path, cdb_path, log_path) = mn1613_monitor_paths();
    JsonTestSettings {
        name: "mn1613_mon_rs".to_string(),
        cpu: AsmCpuType::Mn1613,
        hex_file: hex_path.to_string_lossy().to_string(),
        cdb_file: cdb_path.to_string_lossy().to_string(),
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: Some(log_path.to_string_lossy().to_string()),
        cpu_log_mode: None,
        max_cycles: Some(2_000_000),
    }
}