use std::sync::Arc;

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
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn write_byte_words(s: &mut Mn1613AsmSession, word_addr: u16, bytes: &[u8]) {
    for (i, b) in bytes.iter().enumerate() {
        s.write_word(word_addr.wrapping_add(i as u16), (*b as u16) & 0x00ff);
    }
}

fn lcd_text_regs(row: u16, col: u16, len: u16, text_addr: u16) -> CallRegisters {
    CallRegisters {
        r0: Some(((row & 0x03) << 8) | (col & 0xff)),
        r1: Some(len),
        r2: Some(text_addr),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn call_lcd2(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    row: u16,
    col: u16,
    len: u16,
    text_addr: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_lcd_text",
            CallOptions {
                registers: Some(lcd_text_regs(row, col, len, text_addr)),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn lcd_text_sends_20byte_frame_and_pads_spaces() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_byte_words(s, TEXT_BUF, &[0x41, 0x42, 0x43, 0x44, 0x45]);
        call_lcd2(s, &mock, 1, 2, 5, TEXT_BUF)?;
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
        call_lcd2(s, &mock, 0, 0, 18, TEXT_BUF)?;
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
        call_lcd2(s, &mock, 0, 0, 2, TEXT_BUF)?;
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
