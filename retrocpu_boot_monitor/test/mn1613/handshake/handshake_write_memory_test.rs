use std::sync::Arc;

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

fn call_write(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    payload: &[u8],
) -> Result<Vec<u8>, FrameworkError> {
    mock.run_io_handler_exchange(payload, 1, || {
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
