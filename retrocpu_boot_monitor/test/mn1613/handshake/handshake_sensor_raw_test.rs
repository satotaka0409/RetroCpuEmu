use std::sync::Arc;
use std::time::{Duration, Instant};

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const RTC_SAMPLE: [u8; 7] = [0x56, 0x34, 0x12, 0x09, 0x04, 0x08, 0x26];
const TEMP_SAMPLE: u16 = 0x1a2b;
const LIGHT_CLEAR: u16 = 0x1234;
const LIGHT_RED: u16 = 0x5678;
const LIGHT_GREEN: u16 = 0x9abc;
const LIGHT_BLUE: u16 = 0xdef0;
const DIST_MM: u16 = 0x3456;
const DIST_STATUS: u8 = 0x1d;

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

fn run_one_request(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    symbol: &str,
    regs: CallRegisters,
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let worker = std::thread::spawn(move || serve_cpu_to_io(&io, 1));

    let _ = s.call(
        symbol,
        CallOptions {
            registers: Some(regs),
            ..Default::default()
        },
    )?;

    worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))?
}

#[test]
fn rtc_raw_returns_7_bytes_to_buffer() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.rtc_raw = RTC_SAMPLE;
        }
        let dst = 0x7000u16;
        for i in 0..7u16 {
            s.write_word(dst + i, 0xffff);
        }

        let req = run_one_request(
            s,
            &mock,
            "g_bios_rtc_get_raw",
            CallRegisters {
                r0: Some(dst),
                ..base_regs()
            },
        )?;
        assert_eq!(req, vec![0x1c]);

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        for i in 0..7u16 {
            assert_eq!(s.read_word(dst + i), RTC_SAMPLE[i as usize] as u16);
        }
        Ok(())
    })
}

#[test]
fn temp_raw_returns_16bit_in_r1() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.temp_raw = TEMP_SAMPLE;
        }

        let req = run_one_request(s, &mock, "g_bios_temp_get_raw", base_regs())?;
        assert_eq!(req, vec![0x1d]);

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(TEMP_SAMPLE),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn light_raw_returns_rgbc_words_to_buffer() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.light_raw.clear = LIGHT_CLEAR;
            st.light_raw.red = LIGHT_RED;
            st.light_raw.green = LIGHT_GREEN;
            st.light_raw.blue = LIGHT_BLUE;
        }
        let dst = 0x7010u16;
        for i in 0..4u16 {
            s.write_word(dst + i, 0);
        }

        let req = run_one_request(
            s,
            &mock,
            "g_bios_light_get_raw",
            CallRegisters {
                r0: Some(dst),
                ..base_regs()
            },
        )?;
        assert_eq!(req, vec![0x1e]);

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(s.read_word(dst), LIGHT_CLEAR);
        assert_eq!(s.read_word(dst + 1), LIGHT_RED);
        assert_eq!(s.read_word(dst + 2), LIGHT_GREEN);
        assert_eq!(s.read_word(dst + 3), LIGHT_BLUE);
        Ok(())
    })
}

#[test]
fn distance_raw_returns_distance_and_status() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.distance_raw.distance_mm = DIST_MM;
            st.distance_raw.range_status = DIST_STATUS;
        }

        let req = run_one_request(s, &mock, "g_bios_distance_get_raw", base_regs())?;
        assert_eq!(req, vec![0x1f]);

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(DIST_MM),
                r2: Some((DIST_STATUS & 0x1f) as u16),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
