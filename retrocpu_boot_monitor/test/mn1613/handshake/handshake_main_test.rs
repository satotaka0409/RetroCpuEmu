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

fn feed_io_to_cpu_frame(mock: &IoBoardHandshakeMock, data: &[u8]) -> Result<(), FrameworkError> {
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

fn call_handler(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    to_cpu: &[u8],
    from_cpu_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let frame = to_cpu.to_vec();
    let feeder = std::thread::spawn(move || feed_io_to_cpu_frame(&io, &frame));

    let _ = s.call(
        "g_handshake_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;

    feeder
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io feeder panicked"))??;

    if from_cpu_len == 0 {
        return Ok(Vec::new());
    }
    collect_cpu_reply(mock, from_cpu_len)
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
        assert_eq!(reply, vec![0x00]);
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
