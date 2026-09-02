use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

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

fn call_timer_set(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    timer_no: u16,
    period_ms: u16,
    count: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_timer_set_",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(timer_no),
                    r1: Some(period_ms),
                    r2: Some(count),
                    r3: Some(0x3333),
                    r4: Some(0x4444),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn timer0_100ms_count3_is_sent_to_io_mock() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_timer_set(s, &mock, 0, 100, 3)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        let state = mock.state.lock().expect("state lock");
        let t = state
            .last_timer
            .as_ref()
            .ok_or_else(|| FrameworkError::invalid_argument("last_timer was not recorded"))?;
        assert_eq!(t.timer_no, 0);
        assert_eq!(t.period_ms, 100);
        assert_eq!(t.count, 3);
        Ok(())
    })
}

#[test]
fn timer0_accepts_16bit_period() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_timer_set(s, &mock, 0, 0x1234, 0)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        let state = mock.state.lock().expect("state lock");
        let t = state
            .last_timer
            .as_ref()
            .ok_or_else(|| FrameworkError::invalid_argument("last_timer was not recorded"))?;
        assert_eq!(t.timer_no, 0);
        assert_eq!(t.period_ms, 0x1234);
        assert_eq!(t.count, 0);
        Ok(())
    })
}

#[test]
fn timer1_returns_ng() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_timer_set(s, &mock, 1, 100, 0)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                ..Default::default()
            },
            None,
        )?;
        assert!(mock.state.lock().expect("state lock").last_timer.is_none());
        Ok(())
    })
}

#[test]
fn timer2_returns_ng() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_timer_set(s, &mock, 2, 100, 0)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                ..Default::default()
            },
            None,
        )?;
        assert!(mock.state.lock().expect("state lock").last_timer.is_none());
        Ok(())
    })
}

#[test]
fn timer_set_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_timer_set(s, &mock, 0, 100, 3)?;
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
