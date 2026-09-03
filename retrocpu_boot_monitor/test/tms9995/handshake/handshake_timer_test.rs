use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_regs, expect_ng_r2, expect_ok_r2, with_handshake_case, HSHK_OK,
};

const TMS_DEC_ADDR: u32 = 0xFFFA;
const TMS_DEC_1MS: u16 = 3000;

fn timer_call_regs(session: &retrocpu_test_framework_rs::framework::tms9995::Tms9995AsmSession, timer_no: u16, period: u16, count: u16) -> retrocpu_test_framework_rs::framework::tms9995::Tms9995CallOptions {
    call_regs(session, &[
        None,
        None,
        Some(timer_no),
        Some(period),
        Some(count),
        Some(0x6666),
        Some(0x7777),
        None,
        Some(0x9999),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ])
}

fn read_timer_globals(case: &super::tms9995_handshake_support::HandshakeCase) -> Result<(u16, u16, u16, u16), FrameworkError> {
    let s = &case.session;
    Ok((
        s.read_word_be(s.require_byte_addr("GL_TIMER_PERIOD")?)?,
        s.read_word_be(s.require_byte_addr("GL_TIMER_COUNT")?)?,
        s.read_word_be(s.require_byte_addr("GL_TIMER_ACCUM")?)?,
        s.read_word_be(s.require_byte_addr("GL_TIMER_REMAIN")?)?,
    ))
}

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        for sym in ["g_bios_timer_set_", "g_timer_on_tick", "g_int3_handler"] {
            let _ = case.session.require_byte_addr(sym)?;
        }
        Ok(())
    })
}

#[test]
fn ported_case_02_timer0_100ms_count3_sets_on_chip_state() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = timer_call_regs(&case.session, 0, 100, 3);
        case.session.call("g_bios_timer_set_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        let (period, count, accum, remain) = read_timer_globals(case)?;
        assert_eq!(period, 100);
        assert_eq!(count, 3);
        assert_eq!(accum, 100);
        assert_eq!(remain, 3);
        assert_eq!(case.session.read_word_be(TMS_DEC_ADDR)?, TMS_DEC_1MS);
        assert!(case.io.state.lock().expect("state lock").last_timer.is_none());
        Ok(())
    })
}

#[test]
fn ported_case_03_timer0_accepts_16bit_period() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = timer_call_regs(&case.session, 0, 0x1234, 0);
        case.session.call("g_bios_timer_set_", opts)?;
        let (period, count, _, _) = read_timer_globals(case)?;
        assert_eq!(period, 0x1234);
        assert_eq!(count, 0);
        Ok(())
    })
}

#[test]
fn ported_case_04_timer1_returns_ng() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = timer_call_regs(&case.session, 1, 100, 0);
        case.session.call("g_bios_timer_set_", opts)?;
        case.session.expect_registers(&expect_ng_r2())?;
        Ok(())
    })
}

#[test]
fn ported_case_05_timer2_returns_ng() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = timer_call_regs(&case.session, 2, 100, 0);
        case.session.call("g_bios_timer_set_", opts)?;
        case.session.expect_registers(&expect_ng_r2())?;
        Ok(())
    })
}

#[test]
fn ported_case_06_timer_set_preserves_r6_r7_r9() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = timer_call_regs(&case.session, 0, 100, 3);
        case.session.call("g_bios_timer_set_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(HSHK_OK), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])?;
        Ok(())
    })
}
