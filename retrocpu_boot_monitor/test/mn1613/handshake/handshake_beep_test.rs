use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const BEEP_HZ: u16 = 880;
const BEEP_MS: u16 = 200;

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

fn call_beep(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    frequency_hz: u16,
    duration_ms: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_beep_",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(frequency_hz),
                    r1: Some(duration_ms),
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
fn beep_880hz_200ms_is_sent_to_io_mock() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_beep(s, &mock, BEEP_HZ, BEEP_MS)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;

        let state = mock.state.lock().expect("state lock");
        let beep = state
            .last_beep
            .as_ref()
            .ok_or_else(|| FrameworkError::invalid_argument("last_beep was not recorded"))?;
        assert_eq!(beep.frequency_hz, BEEP_HZ);
        assert_eq!(beep.duration_ms, BEEP_MS);
        Ok(())
    })
}

#[test]
fn beep_frequency_zero_is_accepted_as_stop() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_beep(s, &mock, 0, 100)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;

        let state = mock.state.lock().expect("state lock");
        let beep = state
            .last_beep
            .as_ref()
            .ok_or_else(|| FrameworkError::invalid_argument("last_beep was not recorded"))?;
        assert_eq!(beep.frequency_hz, 0);
        assert_eq!(beep.duration_ms, 100);
        Ok(())
    })
}

#[test]
fn beep_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_beep(s, &mock, BEEP_HZ, BEEP_MS)?;
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
