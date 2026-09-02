use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const KEY_BUF: u16 = 0x1800;
const MODE_FREE: u8 = 1;
const HEX_COLS: [u8; 8] = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];

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

fn call_hex_key(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    buf_word_addr: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_hex_key_get_",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(buf_word_addr),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

fn read_key_buf(s: &Mn1613AsmSession, word_addr: u16) -> [u16; 8] {
    [
        s.read_word(word_addr) & 0x00ff,
        s.read_word(word_addr + 1) & 0x00ff,
        s.read_word(word_addr + 2) & 0x00ff,
        s.read_word(word_addr + 3) & 0x00ff,
        s.read_word(word_addr + 4) & 0x00ff,
        s.read_word(word_addr + 5) & 0x00ff,
        s.read_word(word_addr + 6) & 0x00ff,
        s.read_word(word_addr + 7) & 0x00ff,
    ]
}

#[test]
fn free_mode_returns_hex_columns() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.mode = MODE_FREE;
            st.hex_keys = HEX_COLS;
        }
        call_hex_key(s, &mock, KEY_BUF)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(
            read_key_buf(s, KEY_BUF),
            [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]
        );
        Ok(())
    })
}

#[test]
fn monitor_mode_returns_ng_and_zero_columns() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.hex_keys = HEX_COLS;
        }
        call_hex_key(s, &mock, KEY_BUF)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(read_key_buf(s, KEY_BUF), [0, 0, 0, 0, 0, 0, 0, 0]);
        Ok(())
    })
}

#[test]
fn hex_key_get_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.mode = MODE_FREE;
            st.hex_keys = HEX_COLS;
        }
        call_hex_key(s, &mock, KEY_BUF)?;
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
