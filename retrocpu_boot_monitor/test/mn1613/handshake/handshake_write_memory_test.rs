use std::sync::Arc;
use std::time::{Duration, Instant};

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const WORD_ADDR: u16 = 0x1800;
const BYTE_ADDR: u32 = (WORD_ADDR as u32) * 2;

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

fn mem_write_frame(byte_addr: u32, data: &[u8]) -> Vec<u8> {
    let count = data.len() as u32;
    let mut out = vec![
        0x14,
        ((byte_addr >> 24) & 0xff) as u8,
        ((byte_addr >> 16) & 0xff) as u8,
        ((byte_addr >> 8) & 0xff) as u8,
        (byte_addr & 0xff) as u8,
        ((count >> 24) & 0xff) as u8,
        ((count >> 16) & 0xff) as u8,
        ((count >> 8) & 0xff) as u8,
        (count & 0xff) as u8,
        0,
    ];
    out.extend_from_slice(data);
    out
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
    let timeout = Duration::from_millis(5000);
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
        if start.elapsed() > Duration::from_millis(5000) {
            return Err(FrameworkError::invalid_argument(
                "timeout collecting cpu reply",
            ));
        }
        std::thread::yield_now();
    }
    out.truncate(expected_len);
    Ok(out)
}

fn call_write(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    payload: &[u8],
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let frame = payload.to_vec();
    let worker = std::thread::spawn(move || {
        feed_io_to_cpu_frame(&io, &frame)?;
        collect_cpu_reply(&io, 1)
    });

    wait_req1(mock, Duration::from_millis(5000))?;

    let _ = s.call(
        "g_handshake_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;

    worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))?
}

#[test]
fn write_memory_writes_big_endian_and_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        s.write_word(WORD_ADDR, 0);
        s.write_word(WORD_ADDR + 1, 0);

        let reply = call_write(
            s,
            &mock,
            &mem_write_frame(BYTE_ADDR, &[0x12, 0x34, 0xab, 0xcd]),
        )?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(s.read_word(WORD_ADDR), 0x1234);
        assert_eq!(s.read_word(WORD_ADDR + 1), 0xabcd);
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
fn write_memory_can_access_word_0x8000() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let word = 0x8000u16;
        s.write_word(word, 0);

        let reply = call_write(s, &mock, &mem_write_frame((word as u32) * 2, &[0xa5, 0xa5]))?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(s.read_word(word), 0xa5a5);
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
fn write_memory_can_write_single_byte_to_odd_address() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        s.write_word(WORD_ADDR, 0x1234);

        let reply = call_write(s, &mock, &mem_write_frame(BYTE_ADDR + 1, &[0xaa]))?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(s.read_word(WORD_ADDR), 0x12aa);
        Ok(())
    })
}

#[test]
fn write_memory_zero_count_keeps_memory_and_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        s.write_word(WORD_ADDR, 0x5555);
        let frame = vec![
            0x14,
            ((BYTE_ADDR >> 24) & 0xff) as u8,
            ((BYTE_ADDR >> 16) & 0xff) as u8,
            ((BYTE_ADDR >> 8) & 0xff) as u8,
            (BYTE_ADDR & 0xff) as u8,
            0,
            0,
            0,
            0,
            0,
        ];

        let reply = call_write(s, &mock, &frame)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(s.read_word(WORD_ADDR), 0x5555);
        s.expect_registers(
            &CallRegisters {
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
