use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const SAMPLE_ASCII: u8 = 0x41;
const SAMPLE_KEYCODE: u8 = 0x1e;

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

fn call_pc_key(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_pc_key_get_",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn no_input_returns_zero_ascii_and_keycode() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_pc_key(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(0),
                r2: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn injected_ascii_and_keycode_are_returned_in_r1_r2() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.pc_key = (SAMPLE_ASCII, SAMPLE_KEYCODE);
        }
        call_pc_key(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(SAMPLE_ASCII as u16),
                r2: Some(SAMPLE_KEYCODE as u16),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn pc_key_get_works_in_monitor_mode() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.mode = 0;
            st.pc_key = (SAMPLE_ASCII, SAMPLE_KEYCODE);
        }
        call_pc_key(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(SAMPLE_ASCII as u16),
                r2: Some(SAMPLE_KEYCODE as u16),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn pc_key_get_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.pc_key = (SAMPLE_ASCII, SAMPLE_KEYCODE);
        }
        call_pc_key(s, &mock)?;
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
