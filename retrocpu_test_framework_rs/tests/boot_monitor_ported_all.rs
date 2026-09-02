use std::path::{Path, PathBuf};

use retrocpu_test_framework_rs::framework::tms9995::create_tms9995_session_from_settings;
use retrocpu_test_framework_rs::{create_session_from_settings, AsmCpuType, JsonTestSettings};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .canonicalize()
        .expect("canonicalize repo root")
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
    let repo = repo_root();
    JsonTestSettings {
        name: "mn1613_mon_rs".to_string(),
        cpu: AsmCpuType::Mn1613,
        hex_file: repo
            .join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.ihx")
            .to_string_lossy()
            .to_string(),
        cdb_file: repo
            .join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.cdb")
            .to_string_lossy()
            .to_string(),
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: None,
        cpu_log_mode: None,
        max_cycles: Some(2_000_000),
    }
}

fn tms9995_rs_settings() -> JsonTestSettings {
    let repo = repo_root();
    JsonTestSettings {
        name: "tms9995_mon_rs".to_string(),
        cpu: AsmCpuType::Tms9995,
        hex_file: repo
            .join("retrocpu_boot_monitor/build/hex_rs/tms9995/tms9995_mon_rs.ihx")
            .to_string_lossy()
            .to_string(),
        cdb_file: repo
            .join("retrocpu_boot_monitor/build/hex_rs/tms9995/tms9995_mon_rs.cdb")
            .to_string_lossy()
            .to_string(),
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

#[path = "../../retrocpu_boot_monitor/test/mn1613/bios/bios_common_test.rs"]
mod ported_0;
#[path = "../../retrocpu_boot_monitor/test/mn1613/breakpoint/breakpoint_gl_test.rs"]
mod ported_1;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_hex_keyboard_test.rs"]
mod ported_10;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_io_rw_test.rs"]
mod ported_11;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_lcd1_test.rs"]
mod ported_12;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_lcd2_test.rs"]
mod ported_13;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_led_test.rs"]
mod ported_14;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_main_test.rs"]
mod ported_15;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_pc_keyboard_test.rs"]
mod ported_16;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_read_memory_test.rs"]
mod ported_17;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_sensor_raw_test.rs"]
mod ported_18;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_timer_test.rs"]
mod ported_19;
#[path = "../../retrocpu_boot_monitor/test/mn1613/breakpoint/breakpoint_hist_test.rs"]
mod ported_2;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_undef_test.rs"]
mod ported_20;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_write_memory_test.rs"]
mod ported_21;
#[path = "../../retrocpu_boot_monitor/test/mn1613/interrupt/interrupt_break_test.rs"]
mod ported_22;
#[path = "../../retrocpu_boot_monitor/test/mn1613/interrupt/interrupt_test.rs"]
mod ported_23;
#[path = "../../retrocpu_boot_monitor/test/mn1613/interrupt/interrupt_undef_test.rs"]
mod ported_24;
#[path = "../../retrocpu_boot_monitor/test/mn1613/mn1613_mon_settings.rs"]
mod ported_25;
#[path = "../../retrocpu_boot_monitor/test/tms9995/bios/bios_common_test.rs"]
mod ported_26;
#[path = "../../retrocpu_boot_monitor/test/tms9995/breakpoint/breakpoint_gl_test.rs"]
mod ported_27;
#[path = "../../retrocpu_boot_monitor/test/tms9995/breakpoint/breakpoint_hist_test.rs"]
mod ported_28;
#[path = "../../retrocpu_boot_monitor/test/tms9995/breakpoint/breakpoint_steprun_test.rs"]
mod ported_29;
#[path = "../../retrocpu_boot_monitor/test/mn1613/breakpoint/breakpoint_steprun_test.rs"]
mod ported_3;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_address_break_test.rs"]
mod ported_30;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_beep_test.rs"]
mod ported_31;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_break_hist_test.rs"]
mod ported_32;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_chg_mode_test.rs"]
mod ported_33;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_common_test.rs"]
mod ported_34;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_get_time_test.rs"]
mod ported_35;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_hex_keyboard_test.rs"]
mod ported_36;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_io_rw_test.rs"]
mod ported_37;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_lcd1_test.rs"]
mod ported_38;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_lcd2_test.rs"]
mod ported_39;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_address_break_test.rs"]
mod ported_4;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_led_test.rs"]
mod ported_40;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_main_test.rs"]
mod ported_41;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_pc_keyboard_test.rs"]
mod ported_42;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_read_memory_test.rs"]
mod ported_43;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_sensor_raw_test.rs"]
mod ported_44;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_timer_test.rs"]
mod ported_45;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_undef_test.rs"]
mod ported_46;
#[path = "../../retrocpu_boot_monitor/test/tms9995/handshake/handshake_write_memory_test.rs"]
mod ported_47;
#[path = "../../retrocpu_boot_monitor/test/tms9995/interrupt/interrupt_break_test.rs"]
mod ported_48;
#[path = "../../retrocpu_boot_monitor/test/tms9995/interrupt/interrupt_test.rs"]
mod ported_49;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_beep_test.rs"]
mod ported_5;
#[path = "../../retrocpu_boot_monitor/test/tms9995/interrupt/interrupt_undef_test.rs"]
mod ported_50;
#[path = "../../retrocpu_boot_monitor/test/tms9995/tms9995_artifact.rs"]
mod ported_51;
#[path = "../../retrocpu_boot_monitor/test/tms9995/tms9995_mon_settings.rs"]
mod ported_52;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_break_hist_test.rs"]
mod ported_6;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_chg_mode_test.rs"]
mod ported_7;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_common_test.rs"]
mod ported_8;
#[path = "../../retrocpu_boot_monitor/test/mn1613/handshake/handshake_get_time_test.rs"]
mod ported_9;
