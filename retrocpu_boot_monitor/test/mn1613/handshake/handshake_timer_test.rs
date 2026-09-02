use std::sync::Arc;
use std::time::{Duration, Instant};

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
    let io = Arc::clone(mock);
    let worker = std::thread::spawn(move || serve_cpu_to_io(&io, 6));

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

    let _request = worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;
    Ok(())
}

fn collect_cpu_frame(
    mock: &IoBoardHandshakeMock,
    expected_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let mut frame = Vec::with_capacity(expected_len);
    let start = Instant::now();
    while frame.len() < expected_len {
        if let Some(chunk) = mock.take_cpu_to_io_frame() {
            frame.extend(chunk);
            continue;
        }
        if start.elapsed() > Duration::from_millis(2000) {
            return Err(FrameworkError::invalid_argument(
                "timeout collecting cpu_to_io frame",
            ));
        }
        std::thread::yield_now();
    }
    Ok(frame)
}

fn wait_in_dack<P>(
    mock: &IoBoardHandshakeMock,
    timeout: Duration,
    pred: P,
) -> Result<(), FrameworkError>
where
    P: Fn(u8) -> bool,
{
    let start = Instant::now();
    loop {
        let dack = mock.wires.lock().expect("wires lock").hshk_in_dack;
        if pred(dack) {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err(FrameworkError::invalid_argument(
                "timeout waiting hshk_in_dack",
            ));
        }
        std::thread::yield_now();
    }
}

fn feed_io_response(mock: &IoBoardHandshakeMock, data: &[u8]) -> Result<(), FrameworkError> {
    let timeout = Duration::from_millis(2000);
    {
        let mut w = mock.wires.lock().expect("wires lock");
        w.hshk_in_req = 1;
        w.hshk_in_dena = 0;
    }
    let mut i = 0usize;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        {
            let mut w = mock.wires.lock().expect("wires lock");
            w.hshk_in_data = b0;
            w.hshk_in_dena = 1;
        }
        wait_in_dack(mock, timeout, |d| d != 0)?;
        {
            let mut w = mock.wires.lock().expect("wires lock");
            w.hshk_in_data = b1;
            w.hshk_in_dena = 0;
        }
        wait_in_dack(mock, timeout, |d| d == 0)?;
        i += 2;
    }
    mock.wires.lock().expect("wires lock").hshk_in_req = 0;
    Ok(())
}

fn serve_cpu_to_io(
    mock: &IoBoardHandshakeMock,
    expected_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let req = collect_cpu_frame(mock, expected_len)?;
    let reply = mock.dispatch_cpu_to_io(&req);
    feed_io_response(mock, &reply)?;
    Ok(req)
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
