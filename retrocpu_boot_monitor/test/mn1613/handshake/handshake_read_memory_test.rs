use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const WORD_ADDR: u16 = 0x1800;
const BYTE_ADDR: u32 = (WORD_ADDR as u32) * 2;
const MAX_MEMREAD_TEST_BYTES: usize = 0x2000;
const MEMREAD_TEST_BYTES: usize = 0x0200;

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
    s.max_cycles = Some(250_000_000);
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

fn mem_read_header(byte_addr: u32, byte_count: usize) -> Vec<u8> {
    vec![
        0x13,
        ((byte_addr >> 24) & 0xff) as u8,
        ((byte_addr >> 16) & 0xff) as u8,
        ((byte_addr >> 8) & 0xff) as u8,
        (byte_addr & 0xff) as u8,
        (((byte_count as u32) >> 24) & 0xff) as u8,
        (((byte_count as u32) >> 16) & 0xff) as u8,
        (((byte_count as u32) >> 8) & 0xff) as u8,
        ((byte_count as u32) & 0xff) as u8,
        0,
    ]
}

fn call_read(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    byte_addr: u32,
    byte_count: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let header = mem_read_header(byte_addr, byte_count);
    mock.run_io_handler_exchange_ext(&header, byte_count, Some(&[0x00]), || {
        let _ = s.call(
            "g_handshake_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        Ok(())
    })
}

fn write_byte_at(s: &mut Mn1613AsmSession, byte_addr: u32, b: u8) {
    let waddr = (byte_addr >> 1) as u16;
    let cur = s.read_word(waddr);
    if (byte_addr & 1) != 0 {
        s.write_word(waddr, (cur & 0xff00) | b as u16);
    } else {
        s.write_word(waddr, ((b as u16) << 8) | (cur & 0x00ff));
    }
}

fn fill_pattern(s: &mut Mn1613AsmSession, byte_addr: u32, n: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let b = ((i * 13 + 7) & 0xff) as u8;
        out.push(b);
        write_byte_at(s, byte_addr + i as u32, b);
    }
    out
}

#[test]
fn read_memory_returns_big_endian_bytes() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        s.write_word(WORD_ADDR, 0x1234);
        s.write_word(WORD_ADDR + 1, 0xabcd);

        let reply = call_read(s, &mock, BYTE_ADDR, 4)?;
        assert_eq!(reply, vec![0x12, 0x34, 0xab, 0xcd]);
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
fn read_memory_can_access_word_0x8000() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let word = 0x8000u16;
        s.write_word(word, 0xa5a5);

        let reply = call_read(s, &mock, (word as u32) * 2, 2)?;
        assert_eq!(reply, vec![0xa5, 0xa5]);
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
fn read_memory_zero_count_returns_no_data() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_read(s, &mock, BYTE_ADDR, 0)?;
        assert!(reply.is_empty());
        s.expect_registers(
            &CallRegisters {
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn read_memory_returns_256_bytes() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let n = 256usize;
        let expected = fill_pattern(s, BYTE_ADDR, n);
        let reply = call_read(s, &mock, BYTE_ADDR, n)?;
        assert_eq!(reply, expected);
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
fn read_memory_returns_512_bytes() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        assert!(MEMREAD_TEST_BYTES <= MAX_MEMREAD_TEST_BYTES);
        let expected = fill_pattern(s, BYTE_ADDR, MEMREAD_TEST_BYTES);
        let reply = call_read(s, &mock, BYTE_ADDR, MEMREAD_TEST_BYTES)?;
        assert_eq!(reply.len(), MEMREAD_TEST_BYTES);
        assert_eq!(reply, expected);
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
