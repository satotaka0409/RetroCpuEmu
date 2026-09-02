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

fn call_undef_led(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    arg: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_undef_led",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(arg),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn undef_notify_arg_1_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        assert!(!mock.undef_led());
        call_undef_led(s, &mock, 1)?;
        assert!(mock.undef_led());
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn undef_notify_arg_0_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        assert!(!mock.undef_led());
        call_undef_led(s, &mock, 0)?;
        assert!(mock.undef_led());
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn undef_notify_arg_3_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_undef_led(s, &mock, 3)?;
        assert!(mock.undef_led());
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn undef_notify_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_undef_led(s, &mock, 1)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
