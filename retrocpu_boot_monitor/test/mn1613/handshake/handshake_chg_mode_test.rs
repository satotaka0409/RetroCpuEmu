use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const MODE_MONITOR: u16 = 0;
const MODE_FREE: u16 = 1;

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

fn call_mode_set(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    mode: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_mode_set_",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(mode),
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
fn set_mode_free_updates_io_state() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        assert_eq!(
            mock.state.lock().expect("state lock").mode,
            MODE_MONITOR as u8
        );
        call_mode_set(s, &mock, MODE_FREE)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(mock.state.lock().expect("state lock").mode, MODE_FREE as u8);
        Ok(())
    })
}

#[test]
fn set_mode_monitor_updates_io_state() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.state.lock().expect("state lock").mode = MODE_FREE as u8;
        call_mode_set(s, &mock, MODE_MONITOR)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(
            mock.state.lock().expect("state lock").mode,
            MODE_MONITOR as u8
        );
        Ok(())
    })
}

#[test]
fn invalid_mode_returns_ng_and_keeps_mode() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        assert_eq!(
            mock.state.lock().expect("state lock").mode,
            MODE_MONITOR as u8
        );
        call_mode_set(s, &mock, 2)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(
            mock.state.lock().expect("state lock").mode,
            MODE_MONITOR as u8
        );
        Ok(())
    })
}

#[test]
fn mode_set_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_mode_set(s, &mock, MODE_FREE)?;
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
