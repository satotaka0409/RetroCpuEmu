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
    frame.truncate(expected_len);
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

fn call_lcd1(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    kind: u16,
    arg_a: u16,
    arg_b: u16,
    arg_c: u16,
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let worker = std::thread::spawn(move || serve_cpu_to_io(&io, 6));

    let _ = s.call(
        "g_bios_lcd_control",
        CallOptions {
            registers: Some(CallRegisters {
                r0: Some(kind),
                r1: Some(arg_a),
                r2: Some(((arg_b & 0x03) << 8) | (arg_c & 0xff)),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            }),
            ..Default::default()
        },
    )?;

    let request = worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;
    Ok(request)
}

#[test]
fn lcd_control_sends_kind_arga_argb_argc_frame() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let req = call_lcd1(s, &mock, 3, 0x05, 0x01, 0x0f)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(req, vec![0x17, 0x00, 0x03, 0x05, 0x01, 0x0f]);
        Ok(())
    })
}

#[test]
fn lcd_control_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_lcd1(s, &mock, 2, 0x07, 0x00, 0x00)?;
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
