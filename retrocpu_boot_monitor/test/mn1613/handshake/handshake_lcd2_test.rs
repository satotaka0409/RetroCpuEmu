use std::sync::Arc;
use std::time::{Duration, Instant};

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const TEXT_BUF: u16 = 0x1a00;

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

fn write_byte_words(s: &mut Mn1613AsmSession, word_addr: u16, bytes: &[u8]) {
    for (i, b) in bytes.iter().enumerate() {
        s.write_word(word_addr.wrapping_add(i as u16), (*b as u16) & 0x00ff);
    }
}

fn call_lcd2(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    row: u16,
    col: u16,
    len: u16,
    text_addr: u16,
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let worker = std::thread::spawn(move || serve_cpu_to_io(&io, 20));

    let _ = s.call(
        "g_bios_lcd_text",
        CallOptions {
            registers: Some(CallRegisters {
                r0: Some(((row & 0x03) << 8) | (col & 0xff)),
                r1: Some(len),
                r2: Some(text_addr),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            }),
            ..Default::default()
        },
    )?;

    let req = worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;
    Ok(req)
}

#[test]
fn lcd_text_sends_20byte_frame_and_pads_spaces() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_byte_words(s, TEXT_BUF, &[0x41, 0x42, 0x43, 0x44, 0x45]);
        let req = call_lcd2(s, &mock, 1, 2, 5, TEXT_BUF)?;

        assert_eq!(req.len(), 20);
        assert_eq!(&req[0..4], &[0x18, 0x01, 0x02, 0x05]);
        assert_eq!(&req[4..9], &[0x41, 0x42, 0x43, 0x44, 0x45]);
        assert_eq!(&req[9..20], &[0x20; 11]);
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
fn lcd_text_len_gt_16_sends_first_16_chars_only() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let chars: Vec<u8> = (0..18).map(|i| 0x41 + i as u8).collect();
        write_byte_words(s, TEXT_BUF, &chars);
        let req = call_lcd2(s, &mock, 0, 0, 18, TEXT_BUF)?;

        assert_eq!(&req[4..20], &chars[0..16]);
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
fn lcd_text_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_byte_words(s, TEXT_BUF, &[0x48, 0x49]);
        let _ = call_lcd2(s, &mock, 0, 0, 2, TEXT_BUF)?;
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
