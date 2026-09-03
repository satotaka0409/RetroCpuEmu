use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{call_cpu_to_io, call_regs, with_handshake_case};

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_lcd_text_")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_case_02() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let row_col = ((1 & 3) << 8) | 2;
        let opts = call_regs(&case.session, &[
            None, None, None, Some(5), None, None, Some(0x6666), Some(0x7777),
            Some(row_col), Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_lcd_text_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_03_r3_r4() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = call_regs(&case.session, &[
            None, None, None, Some(2), None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_lcd_text_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
