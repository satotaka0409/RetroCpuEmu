use std::sync::Arc;
use std::time::{Duration, Instant};

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
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn wait_req1(mock: &IoBoardHandshakeMock, timeout: Duration) -> Result<(), FrameworkError> {
    let start = Instant::now();
    loop {
        if mock.wires.lock().expect("wires lock").hshk_in_req == 1 {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err(FrameworkError::invalid_argument(
                "timeout waiting hshk_in_req",
            ));
        }
        std::thread::yield_now();
    }
}

fn collect_cpu_reply(
    mock: &IoBoardHandshakeMock,
    expected_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let mut out = Vec::with_capacity(expected_len);
    let start = Instant::now();
    while out.len() < expected_len {
        if let Some(chunk) = mock.take_cpu_to_io_frame() {
            out.extend(chunk);
            continue;
        }
        if start.elapsed() > Duration::from_millis(2000) {
            return Err(FrameworkError::invalid_argument(
                "timeout collecting cpu reply",
            ));
        }
        std::thread::yield_now();
    }
    out.truncate(expected_len);
    Ok(out)
}

#[test]
fn cmd_15h_read_io_returns_requested_bytes_plus_status() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = s.call(
            "g_hshk_accept_request",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;

        let io = Arc::clone(&mock);
        let frame = vec![0x00, 0x00, 0xa0, 0x02, 0x00];
        let worker = std::thread::spawn(move || {
            let mut poll = || std::thread::yield_now();
            io.exchange_with_cpu(&frame, 0, &mut poll)
        });

        wait_req1(&mock, Duration::from_millis(2000))?;

        let _ = s.call(
            "g_hshk_read_io",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;

        worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;
        let reply = collect_cpu_reply(&mock, 3)?;
        assert_eq!(reply.len(), 3);
        assert_eq!(reply[2], 0);
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
