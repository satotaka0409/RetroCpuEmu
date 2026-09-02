use std::path::PathBuf;

use retrocpu_test_framework_rs::types::AsmCpuType;
use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    JsonTestSettings,
};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn mn1613_rs_settings() -> JsonTestSettings {
    let root = repo_root();
    let hex = root
        .join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.ihx")
        .to_string_lossy()
        .to_string();
    let cdb = root
        .join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.cdb")
        .to_string_lossy()
        .to_string();

    JsonTestSettings {
        name: "mn1613_mon_rs".to_string(),
        cpu: AsmCpuType::Mn1613,
        hex_file: hex,
        cdb_file: cdb,
        init_label: Some("g_main".to_string()),
        io_mock: Some(vec![CodeTestIoMockEntry::Handshake]),
        cpu_log_file: None,
        cpu_log_mode: None,
        max_cycles: Some(2_000_000),
    }
}

fn monitor_artifact_exists() -> bool {
    let root = repo_root();
    let hex = root.join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.ihx");
    let cdb = root.join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.cdb");
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

fn with_case<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut retrocpu_test_framework_rs::Mn1613AsmSession) -> Result<(), FrameworkError>,
{
    if !monitor_artifact_exists() {
        return Ok(());
    }
    let mut session = create_session_from_settings(&mn1613_rs_settings(), None)?;
    session.reload()?;
    session.run_init()?;
    let out = f(&mut session);
    session.detach_io_mock();
    out
}

fn call_handler(
    session: &mut retrocpu_test_framework_rs::Mn1613AsmSession,
    to_cpu: &[u8],
) -> Result<Vec<u8>, FrameworkError> {
    let mock = session.require_handshake_mock()?;
    mock.push_io_to_cpu(to_cpu);

    let result = session.call(
        "g_handshake_interrupt_handler",
        CallOptions {
            registers: Some(CallRegisters {
                r2: Some(0x2222),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            }),
            ..Default::default()
        },
    )?;

    assert_eq!(result.registers.r[0], 0);
    assert_eq!(result.registers.r[4], 0x4444);

    Ok(mock.take_cpu_to_io_frame().unwrap_or_default())
}

#[test]
fn cmd_lt_0x10_completes_without_dispatch() -> Result<(), FrameworkError> {
    with_case(|session| {
        let reply = call_handler(session, &[0x0f])?;
        assert!(reply.is_empty());
        Ok(())
    })
}

#[test]
fn unknown_cmd_completes_without_ng_reply() -> Result<(), FrameworkError> {
    with_case(|session| {
        let reply = call_handler(session, &[0x44])?;
        assert!(reply.is_empty());
        Ok(())
    })
}

#[test]
fn exec_cmd_reads_five_bytes_and_returns_ng() -> Result<(), FrameworkError> {
    with_case(|session| {
        let reply = call_handler(session, &[0x12, 0x00, 0x00, 0x02, 0x00, 0x00])?;
        assert_eq!(reply, vec![0x01]);
        Ok(())
    })
}

#[test]
fn removed_cpu_state_cmd_completes_without_reply() -> Result<(), FrameworkError> {
    with_case(|session| {
        let reply = call_handler(session, &[0x48])?;
        assert!(reply.is_empty());
        Ok(())
    })
}
