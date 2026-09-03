use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

fn base_regs() -> CallRegisters {
    CallRegisters {
        r2: Some(0x2222),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn handshake_settings() -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![CodeTestIoMockEntry::Handshake]);
    s
}

fn with_case<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession, Arc<IoBoardHandshakeMock>) -> Result<(), FrameworkError>,
{
    let mut s = create_session_from_settings(&handshake_settings(), None)?;
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn call_handler(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    to_cpu: &[u8],
    from_cpu_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    mock.run_io_handler_exchange(to_cpu, from_cpu_len, || {
        let _ = s.call(
            "g_handshake_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        Ok(())
    })
}

#[test]
fn cmd_0x0f_is_ignored_without_reply() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(s, &mock, &[0x0f], 0)?;
        assert!(reply.is_empty());
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn cmd_0x44_finishes_without_reply() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(s, &mock, &[0x44], 0)?;
        assert!(reply.is_empty());
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn cmd_0x12_drains_payload_and_returns_ng() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(s, &mock, &[0x12, 0x00, 0x00, 0x02, 0x00, 0x00], 1)?;
        assert_eq!(reply, vec![0x01]);
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn cmd_0x48_finishes_without_reply() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(s, &mock, &[0x48], 0)?;
        assert!(reply.is_empty());
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
