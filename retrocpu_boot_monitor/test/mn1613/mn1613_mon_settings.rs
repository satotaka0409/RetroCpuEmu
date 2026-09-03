use std::path::{Path, PathBuf};

use retrocpu_test_framework_rs::{
    create_session_from_settings, AsmCpuType, CodeTestIoMockEntry, CpuLogMode, FrameworkError,
    JsonTestSettings,
};

fn derive_log_stem(test_file: &str) -> String {
    let p = Path::new(test_file);
    let file = p.file_name().and_then(|s| s.to_str()).unwrap_or(test_file);
    file.trim_end_matches("_test.ts")
        .trim_end_matches("_test.rs")
        .to_string()
}

fn select_cpu_log_mode(explicit: Option<CpuLogMode>, env_mode: Option<&str>) -> Option<CpuLogMode> {
    if explicit.is_some() {
        return explicit;
    }
    match env_mode {
        Some("checkpoint") => Some(CpuLogMode::Checkpoint),
        Some("instruction") => Some(CpuLogMode::Instruction),
        _ => None,
    }
}

fn with_mn1613_cpu_log_rs(
    settings: &JsonTestSettings,
    test_file: &str,
    explicit_mode: Option<CpuLogMode>,
    env_mode: Option<&str>,
) -> JsonTestSettings {
    let mut s = settings.clone();
    let repo = super::repo_root();
    let stem = derive_log_stem(test_file);
    let log_path = repo
        .join("retrocpu_boot_monitor")
        .join("logs")
        .join("mn1613")
        .join(format!("{stem}.log"));
    s.cpu_log_file = Some(log_path.to_string_lossy().to_string());
    s.cpu_log_mode = select_cpu_log_mode(explicit_mode, env_mode);
    s
}

fn mn1613_mon_handshake_rs_settings() -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![CodeTestIoMockEntry::Handshake]);
    s
}

#[test]
fn mn1613_mon_settings_points_to_rs_artifacts() {
    let s = super::mn1613_rs_settings();
    let (hex, cdb, log) = super::mn1613_monitor_paths();
    assert_eq!(s.name, "mn1613_mon_rs");
    assert_eq!(s.cpu, AsmCpuType::Mn1613);
    assert_eq!(PathBuf::from(&s.hex_file), hex);
    assert_eq!(PathBuf::from(&s.cdb_file), cdb);
    assert_eq!(PathBuf::from(s.cpu_log_file.expect("cpu_log_file")), log);
    assert_eq!(s.init_label.as_deref(), Some("g_main"));
}

#[test]
fn with_mn1613_cpu_log_rs_sets_log_file_stem_from_test_name() {
    let base = super::mn1613_rs_settings();
    let s = with_mn1613_cpu_log_rs(
        &base,
        "test/mn1613/handshake/handshake_timer_test.rs",
        None,
        None,
    );

    let p = PathBuf::from(s.cpu_log_file.expect("cpu_log_file"));
    assert_eq!(
        p.file_name().and_then(|x| x.to_str()),
        Some("handshake_timer.log")
    );
    assert!(p
        .to_string_lossy()
        .contains("retrocpu_boot_monitor/logs/mn1613/handshake_timer.log"));
}

#[test]
fn with_mn1613_cpu_log_rs_prefers_explicit_mode_over_env() {
    let base = super::mn1613_rs_settings();
    let s = with_mn1613_cpu_log_rs(
        &base,
        "test/mn1613/handshake/handshake_timer_test.rs",
        Some(CpuLogMode::Instruction),
        Some("checkpoint"),
    );
    assert_eq!(s.cpu_log_mode, Some(CpuLogMode::Instruction));
}

#[test]
fn with_mn1613_cpu_log_rs_uses_valid_env_mode_when_explicit_absent() {
    let base = super::mn1613_rs_settings();
    let checkpoint = with_mn1613_cpu_log_rs(
        &base,
        "test/mn1613/handshake/handshake_timer_test.rs",
        None,
        Some("checkpoint"),
    );
    let instruction = with_mn1613_cpu_log_rs(
        &base,
        "test/mn1613/handshake/handshake_timer_test.rs",
        None,
        Some("instruction"),
    );
    let invalid = with_mn1613_cpu_log_rs(
        &base,
        "test/mn1613/handshake/handshake_timer_test.rs",
        None,
        Some("other"),
    );

    assert_eq!(checkpoint.cpu_log_mode, Some(CpuLogMode::Checkpoint));
    assert_eq!(instruction.cpu_log_mode, Some(CpuLogMode::Instruction));
    assert_eq!(invalid.cpu_log_mode, None);
}

#[test]
fn handshake_settings_attach_handshake_mock_and_session_uses_it() -> Result<(), FrameworkError> {
    let mut s = create_session_from_settings(&mn1613_mon_handshake_rs_settings(), None)?;
    let hs = s.require_handshake_mock()?;
    hs.set_timestamp_u64(0x0123_4567_89ab_cdef);
    s.detach_io_mock();
    Ok(())
}
