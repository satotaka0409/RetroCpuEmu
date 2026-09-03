use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ng_r2, expect_ok_r2, with_handshake_case, HSHK_OK,
};

const MODE_MONITOR: u16 = 0;
const MODE_FREE: u16 = 1;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_mode_set_")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_set_mode_free_updates_io_state() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        assert_eq!(case.io.state.lock().expect("state lock").mode, MODE_MONITOR as u8);
        let opts = call_regs(&case.session, &[
            None, None, None, None, Some(MODE_FREE), None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_mode_set_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        assert_eq!(case.io.state.lock().expect("state lock").mode, MODE_FREE as u8);
        Ok(())
    })
}

#[test]
fn ported_case_03_set_mode_monitor_updates_io_state() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").mode = MODE_FREE as u8;
        let opts = call_regs(&case.session, &[
            None, None, None, None, Some(MODE_MONITOR), None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_mode_set_", opts)?;
        assert_eq!(
            case.io.state.lock().expect("state lock").mode,
            MODE_MONITOR as u8
        );
        Ok(())
    })
}

#[test]
fn ported_case_04_invalid_mode_returns_ng_and_keeps_mode() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = call_regs(&case.session, &[
            None, None, None, None, Some(2), None, Some(0x6666), Some(0x7777), None, Some(0x9999),
            None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_mode_set_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        assert_eq!(
            case.io.state.lock().expect("state lock").mode,
            MODE_MONITOR as u8
        );
        Ok(())
    })
}

#[test]
fn ported_case_05_mode_set_preserves_r6_r7_r9() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = call_regs(&case.session, &[
            None, None, None, None, Some(MODE_FREE), None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_mode_set_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(HSHK_OK), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
