use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ok_r2, with_handshake_case,
};

const SAMPLE_ASCII: u8 = 0x41;
const SAMPLE_KEYCODE: u8 = 0x1e;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_pc_key_get_")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_no_input_returns_zero() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = call_regs(&case.session, &[None; 16]);
        call_cpu_to_io(case, "g_bios_pc_key_get_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0), Some(0), Some(0), None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_03_injected_key_in_r3_r4() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").pc_key =
            (SAMPLE_ASCII, SAMPLE_KEYCODE);
        let opts = call_regs(&case.session, &[None; 16]);
        call_cpu_to_io(case, "g_bios_pc_key_get_", opts)?;
        case.session.expect_registers(&[
            None,
            None,
            Some(0),
            Some(SAMPLE_ASCII as u16),
            Some(SAMPLE_KEYCODE as u16),
            None,
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
        ])
    })
}

#[test]
fn ported_case_04_pc_key_preserves_r6_r7_r9() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").pc_key = (SAMPLE_ASCII, SAMPLE_KEYCODE);
        let opts = call_regs(&case.session, &[None; 16]);
        call_cpu_to_io(case, "g_bios_pc_key_get_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
