use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{call_cpu_to_io, call_regs, with_handshake_case};

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_undef_led")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_undef_notify_returns_ok_and_sets_led() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        assert!(!case.io.undef_led());
        call_cpu_to_io(
            case,
            "g_bios_undef_led",
            call_regs(&case.session, &[None; 16]),
        )?;
        assert!(case.io.undef_led());
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_03_undef_arg_zero_still_notifies() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        call_cpu_to_io(
            case,
            "g_bios_undef_led",
            call_regs(&case.session, &[None; 16]),
        )?;
        assert!(case.io.undef_led());
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_04_r3_r4() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        call_cpu_to_io(
            case,
            "g_bios_undef_led",
            call_regs(&case.session, &[None; 16]),
        )?;
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
