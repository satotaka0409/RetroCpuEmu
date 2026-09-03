use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ok_r2, with_handshake_case,
};

const KEY_BUF: u16 = 0x7000;
const MODE_FREE: u16 = 1;
const HEX_COLS: [u8; 8] = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80];

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_hex_key_get_")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_case_02() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").mode = MODE_FREE as u8;
        for (i, &col) in HEX_COLS.iter().enumerate() {
            case.io.state.lock().expect("state lock").hex_keys[i] = col;
        }
        for i in 0..8u16 {
            case.session.write_word_be(u32::from(KEY_BUF + i * 2), 0)?;
        }
        let opts = call_regs(&case.session, &[
            None, None, Some(KEY_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_hex_key_get_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        for (i, &exp) in HEX_COLS.iter().enumerate() {
            assert_eq!(
                case.session.read_word_be(u32::from(KEY_BUF + (i as u16 * 2)))? & 0xff,
                u16::from(exp)
            );
        }
        Ok(())
    })
}

#[test]
fn ported_case_03_case_03() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let opts = call_regs(&case.session, &[
            None, None, Some(KEY_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        let r = call_cpu_to_io(case, "g_bios_hex_key_get_", opts)?;
        assert_eq!(r.len(), 0);
        case.session.expect_registers(&[
            None, None, Some(0x01), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_04_r3_r4() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").mode = MODE_FREE as u8;
        let opts = call_regs(&case.session, &[
            None, None, Some(KEY_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_hex_key_get_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
