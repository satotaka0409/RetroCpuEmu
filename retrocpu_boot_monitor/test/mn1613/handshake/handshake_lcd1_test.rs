use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

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

fn lcd_control_regs(kind: u16, arg_a: u16, arg_b: u16, arg_c: u16) -> CallRegisters {
    CallRegisters {
        r0: Some(kind),
        r1: Some(arg_a),
        r2: Some(((arg_b & 0x03) << 8) | (arg_c & 0xff)),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn call_lcd1(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    kind: u16,
    arg_a: u16,
    arg_b: u16,
    arg_c: u16,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_bios_lcd_control",
            CallOptions {
                registers: Some(lcd_control_regs(kind, arg_a, arg_b, arg_c)),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn lcd_control_sends_kind_arga_argb_argc_frame() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_lcd1(s, &mock, 3, 0x05, 0x01, 0x0f)?;
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
fn lcd_control_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_lcd1(s, &mock, 2, 0x07, 0x00, 0x00)?;
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
