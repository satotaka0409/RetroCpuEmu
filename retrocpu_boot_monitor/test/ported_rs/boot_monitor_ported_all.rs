use std::path::{Path, PathBuf};

use retrocpu_test_framework_rs::framework::tms9995::create_tms9995_session_from_settings;
use retrocpu_test_framework_rs::{create_session_from_settings, AsmCpuType, JsonTestSettings};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("canonicalize repo root")
}

fn test_setting_json_path() -> PathBuf {
    repo_root().join("retrocpu_boot_monitor/test/test_setting.json")
}

fn load_artifact_paths(cpu_key: &str) -> (PathBuf, PathBuf) {
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

    let monitor_root = repo_root().join("retrocpu_boot_monitor");
    (monitor_root.join(ihx_rel), monitor_root.join(cdb_rel))
}

fn source_path(source_rel: &str) -> PathBuf {
    let repo = repo_root();
    repo.join("retrocpu_boot_monitor").join(source_rel)
}

fn assert_source_exists(source_rel: &str) {
    let p = source_path(source_rel);
    assert!(p.exists(), "missing source test: {source_rel}");
}

fn mn1613_rs_settings() -> JsonTestSettings {
    let (hex_path, cdb_path) = load_artifact_paths("mn1613");
    JsonTestSettings {
        name: "mn1613_mon_rs".to_string(),
        cpu: AsmCpuType::Mn1613,
        hex_file: hex_path.to_string_lossy().to_string(),
        cdb_file: cdb_path.to_string_lossy().to_string(),
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: None,
        cpu_log_mode: None,
        max_cycles: Some(2_000_000),
    }
}

fn tms9995_rs_settings() -> JsonTestSettings {
    let (hex_path, cdb_path) = load_artifact_paths("tms9995");
    JsonTestSettings {
        name: "tms9995_mon_rs".to_string(),
        cpu: AsmCpuType::Tms9995,
        hex_file: hex_path.to_string_lossy().to_string(),
        cdb_file: cdb_path.to_string_lossy().to_string(),
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: None,
        cpu_log_mode: None,
        max_cycles: Some(2_000_000),
    }
}

fn assert_mn1613_symbols_have_code(source_rel: &str, symbols: &[&str]) {
    assert_source_exists(source_rel);
    let settings = mn1613_rs_settings();
    let session =
        create_session_from_settings(&settings, None).expect("mn1613 session from settings");
    for sym in symbols {
        let addr = session
            .word_addr(sym)
            .unwrap_or_else(|_| panic!("missing mn1613 symbol: {sym}"));
        let op = session.read_word(addr);
        assert_ne!(op, 0, "mn1613 symbol has zero opcode at entry: {sym}");
    }
}

#[allow(dead_code)]
fn assert_mn1613_symbols(source_rel: &str, symbols: &[&str]) {
    assert_mn1613_symbols_have_code(source_rel, symbols);
}

fn assert_tms9995_symbols_have_code(source_rel: &str, symbols: &[&str]) {
    assert_source_exists(source_rel);
    let settings = tms9995_rs_settings();
    let session = create_tms9995_session_from_settings(&settings, None)
        .expect("tms9995 session from settings");
    for sym in symbols {
        let addr = session
            .require_byte_addr(sym)
            .unwrap_or_else(|_| panic!("missing tms9995 symbol: {sym}"));
        let b0 = session
            .read_byte(addr)
            .unwrap_or_else(|_| panic!("unreadable tms9995 code byte: {sym}"));
        let b1 = session
            .read_byte(addr.wrapping_add(1))
            .unwrap_or_else(|_| panic!("unreadable tms9995 code byte+1: {sym}"));
        assert!(
            b0 != 0 || b1 != 0,
            "tms9995 symbol has zero code bytes: {sym}"
        );
    }
}

fn assert_tms9995_symbols(source_rel: &str, symbols: &[&str]) {
    assert_tms9995_symbols_have_code(source_rel, symbols);
}

fn assert_tms9995_artifact_layout(source_rel: &str) {
    assert_source_exists(source_rel);
    let settings = tms9995_rs_settings();
    let session = create_tms9995_session_from_settings(&settings, None)
        .expect("tms9995 session from settings");
    assert!(session.cdb().symbols.len() > 100, "unexpectedly small CDB");

    let reset_vec = session.read_word_be(0).expect("read reset vector");
    assert_ne!(reset_vec, 0, "reset vector must not be zero");
}

#[path = "../mn1613/bios/bios_common_test.rs"]
mod mn1613_bios_common_test;
#[path = "../mn1613/breakpoint/breakpoint_gl_test.rs"]
mod mn1613_breakpoint_gl_test;
#[path = "../mn1613/breakpoint/breakpoint_hist_test.rs"]
mod mn1613_breakpoint_hist_test;
#[path = "../mn1613/breakpoint/breakpoint_steprun_test.rs"]
mod mn1613_breakpoint_steprun_test;
#[path = "../mn1613/handshake/handshake_address_break_test.rs"]
mod mn1613_handshake_address_break_test;
#[path = "../mn1613/handshake/handshake_beep_test.rs"]
mod mn1613_handshake_beep_test;
#[path = "../mn1613/handshake/handshake_break_hist_test.rs"]
mod mn1613_handshake_break_hist_test;
#[path = "../mn1613/handshake/handshake_chg_mode_test.rs"]
mod mn1613_handshake_chg_mode_test;
#[path = "../mn1613/handshake/handshake_common_test.rs"]
mod mn1613_handshake_common_test;
#[path = "../mn1613/handshake/handshake_get_time_test.rs"]
mod mn1613_handshake_get_time_test;
#[path = "../mn1613/handshake/handshake_hex_keyboard_test.rs"]
mod mn1613_handshake_hex_keyboard_test;
#[path = "../mn1613/handshake/handshake_io_rw_test.rs"]
mod mn1613_handshake_io_rw_test;
#[path = "../mn1613/handshake/handshake_lcd1_test.rs"]
mod mn1613_handshake_lcd1_test;
#[path = "../mn1613/handshake/handshake_lcd2_test.rs"]
mod mn1613_handshake_lcd2_test;
#[path = "../mn1613/handshake/handshake_led_test.rs"]
mod mn1613_handshake_led_test;
#[path = "../mn1613/handshake/handshake_main_test.rs"]
mod mn1613_handshake_main_test;
#[path = "../mn1613/handshake/handshake_pc_keyboard_test.rs"]
mod mn1613_handshake_pc_keyboard_test;
#[path = "../mn1613/handshake/handshake_read_memory_test.rs"]
mod mn1613_handshake_read_memory_test;
#[path = "../mn1613/handshake/handshake_sensor_raw_test.rs"]
mod mn1613_handshake_sensor_raw_test;
#[path = "../mn1613/handshake/handshake_timer_test.rs"]
mod mn1613_handshake_timer_test;
#[path = "../mn1613/handshake/handshake_undef_test.rs"]
mod mn1613_handshake_undef_test;
#[path = "../mn1613/handshake/handshake_write_memory_test.rs"]
mod mn1613_handshake_write_memory_test;
#[path = "../mn1613/interrupt/interrupt_break_test.rs"]
mod mn1613_interrupt_break_test;
#[path = "../mn1613/interrupt/interrupt_test.rs"]
mod mn1613_interrupt_test;
#[path = "../mn1613/interrupt/interrupt_undef_test.rs"]
mod mn1613_interrupt_undef_test;
#[path = "../mn1613/mn1613_mon_settings.rs"]
mod mn1613_mon_settings;
#[path = "../tms9995/tms9995_artifact.rs"]
mod tms9995_artifact;
#[path = "../tms9995/bios/bios_common_test.rs"]
mod tms9995_bios_common_test;
#[path = "../tms9995/breakpoint/breakpoint_gl_test.rs"]
mod tms9995_breakpoint_gl_test;
#[path = "../tms9995/breakpoint/breakpoint_hist_test.rs"]
mod tms9995_breakpoint_hist_test;
#[path = "../tms9995/breakpoint/breakpoint_steprun_test.rs"]
mod tms9995_breakpoint_steprun_test;
#[path = "../tms9995/handshake/handshake_address_break_test.rs"]
mod tms9995_handshake_address_break_test;
#[path = "../tms9995/handshake/handshake_beep_test.rs"]
mod tms9995_handshake_beep_test;
#[path = "../tms9995/handshake/handshake_break_hist_test.rs"]
mod tms9995_handshake_break_hist_test;
#[path = "../tms9995/handshake/handshake_chg_mode_test.rs"]
mod tms9995_handshake_chg_mode_test;
#[path = "../tms9995/handshake/handshake_common_test.rs"]
mod tms9995_handshake_common_test;
#[path = "../tms9995/handshake/handshake_get_time_test.rs"]
mod tms9995_handshake_get_time_test;
#[path = "../tms9995/handshake/handshake_hex_keyboard_test.rs"]
mod tms9995_handshake_hex_keyboard_test;
#[path = "../tms9995/handshake/handshake_io_rw_test.rs"]
mod tms9995_handshake_io_rw_test;
#[path = "../tms9995/handshake/handshake_lcd1_test.rs"]
mod tms9995_handshake_lcd1_test;
#[path = "../tms9995/handshake/handshake_lcd2_test.rs"]
mod tms9995_handshake_lcd2_test;
#[path = "../tms9995/handshake/handshake_led_test.rs"]
mod tms9995_handshake_led_test;
#[path = "../tms9995/handshake/handshake_main_test.rs"]
mod tms9995_handshake_main_test;
#[path = "../tms9995/handshake/handshake_pc_keyboard_test.rs"]
mod tms9995_handshake_pc_keyboard_test;
#[path = "../tms9995/handshake/handshake_read_memory_test.rs"]
mod tms9995_handshake_read_memory_test;
#[path = "../tms9995/handshake/handshake_sensor_raw_test.rs"]
mod tms9995_handshake_sensor_raw_test;
#[path = "../tms9995/handshake/handshake_timer_test.rs"]
mod tms9995_handshake_timer_test;
#[path = "../tms9995/handshake/handshake_undef_test.rs"]
mod tms9995_handshake_undef_test;
#[path = "../tms9995/handshake/handshake_write_memory_test.rs"]
mod tms9995_handshake_write_memory_test;
#[path = "../tms9995/interrupt/interrupt_break_test.rs"]
mod tms9995_interrupt_break_test;
#[path = "../tms9995/interrupt/interrupt_test.rs"]
mod tms9995_interrupt_test;
#[path = "../tms9995/interrupt/interrupt_undef_test.rs"]
mod tms9995_interrupt_undef_test;
#[path = "../tms9995/tms9995_mon_settings.rs"]
mod tms9995_mon_settings;
