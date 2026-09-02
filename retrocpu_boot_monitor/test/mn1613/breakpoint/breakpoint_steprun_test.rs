use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const GL_BP_STEP_ARM: &str = "GL_BP_STEP_ARM";
const INT1_STR_SAVE: u16 = 2;
const INT1_IC_SAVE: u16 = 3;
const USER_IC: u16 = 0x1800;
const IDLE_IC: u16 = 0x1b00;

fn base_regs() -> CallRegisters {
    CallRegisters {
        r2: Some(0x2222),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn with_plain_session<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession) -> Result<(), FrameworkError>,
{
    let mut s = create_session_from_settings(&super::mn1613_rs_settings(), None)?;
    s.run_init()?;
    f(&mut s)
}

fn handshake_settings() -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![CodeTestIoMockEntry::Handshake]);
    s
}

fn with_handshake_session<F>(f: F) -> Result<(), FrameworkError>
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

fn call_break_resume(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    mode: u8,
) -> Result<Vec<u8>, FrameworkError> {
    mock.run_io_handler_exchange(&[0x18, mode], 1, || {
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

fn preset_io_status_byte(mock: &IoBoardHandshakeMock) {
    let mut w = mock.wires.lock().expect("wires lock");
    w.hshk_in_req = 1;
    w.hshk_in_dena = 1;
    w.hshk_in_data = 0;
}

fn call_step_interrupt_and_capture(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
) -> Result<Vec<u8>, FrameworkError> {
    preset_io_status_byte(mock);
    mock.run_with_cpu_out_capture(60, || {
        let r = s.call(
            "g_step_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], 1);
        Ok(())
    })
}

#[test]
fn mode0_returns_ok_and_clears_arm() -> Result<(), FrameworkError> {
    with_handshake_session(|s, mock| {
        let arm = s.word_addr(GL_BP_STEP_ARM)?;
        s.write_word(arm, 1);
        let reply = call_break_resume(s, &mock, 0)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(s.read_word(arm), 0);
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
fn mode1_returns_ok_and_sets_arm() -> Result<(), FrameworkError> {
    with_handshake_session(|s, mock| {
        let arm = s.word_addr(GL_BP_STEP_ARM)?;
        s.write_word(arm, 0);
        let reply = call_break_resume(s, &mock, 1)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(s.read_word(arm), 1);
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
fn mode2_returns_ng_and_keeps_arm() -> Result<(), FrameworkError> {
    with_handshake_session(|s, mock| {
        let arm = s.word_addr(GL_BP_STEP_ARM)?;
        s.write_word(arm, 0);
        let reply = call_break_resume(s, &mock, 2)?;
        assert_eq!(reply, vec![0x01]);
        assert_eq!(s.read_word(arm), 0);
        Ok(())
    })
}

#[test]
fn step_arm_cpld_when_arm1_clears_arm() -> Result<(), FrameworkError> {
    with_plain_session(|s| {
        let arm = s.word_addr(GL_BP_STEP_ARM)?;
        s.write_word(arm, 1);
        let _ = s.call(
            "g_step_arm_cpld",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(s.read_word(arm), 0);
        Ok(())
    })
}

#[test]
fn step_arm_cpld_when_arm0_keeps_arm() -> Result<(), FrameworkError> {
    with_plain_session(|s| {
        let arm = s.word_addr(GL_BP_STEP_ARM)?;
        s.write_word(arm, 0);
        let _ = s.call(
            "g_step_arm_cpld",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(s.read_word(arm), 0);
        Ok(())
    })
}

#[test]
fn step_interrupt_notify_contains_user_ic() -> Result<(), FrameworkError> {
    with_handshake_session(|s, mock| {
        s.write_word(INT1_STR_SAVE, 0x0700);
        s.write_word(INT1_IC_SAVE, USER_IC);

        let frame = call_step_interrupt_and_capture(s, &mock)?;
        assert!(frame.len() >= 6);
        assert_eq!(frame[0], 0x1b);
        let ic = ((frame[4] as u16) << 8) | frame[5] as u16;
        assert_eq!(ic, USER_IC);
        Ok(())
    })
}

#[test]
fn step_interrupt_notify_contains_main_loop_ic() -> Result<(), FrameworkError> {
    with_handshake_session(|s, mock| {
        s.write_word(INT1_STR_SAVE, 0x0700);
        s.write_word(INT1_IC_SAVE, IDLE_IC);

        let frame = call_step_interrupt_and_capture(s, &mock)?;
        assert!(frame.len() >= 6);
        assert_eq!(frame[0], 0x1b);
        let ic = ((frame[4] as u16) << 8) | frame[5] as u16;
        assert_eq!(ic, IDLE_IC);
        Ok(())
    })
}
