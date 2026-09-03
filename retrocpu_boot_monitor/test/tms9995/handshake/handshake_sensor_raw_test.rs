use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ok_r2, with_handshake_case,
};

const RTC_BUF: u16 = 0x7000;
const LIGHT_BUF: u16 = 0x7010;
const RTC_SAMPLE: [u8; 7] = [0x56, 0x34, 0x12, 0x09, 0x04, 0x08, 0x26];
const TEMP_SAMPLE: u16 = 0x1a2b;
const LIGHT_SAMPLE: [u16; 4] = [0x1234, 0x5678, 0x9abc, 0xdef0];
const DIST_SAMPLE_MM: u16 = 0x3456;
const DIST_SAMPLE_STATUS: u16 = 0x1d;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        for sym in [
            "g_bios_rtc_get_raw_",
            "g_bios_temp_get_raw_",
            "g_bios_light_get_raw_",
            "g_bios_distance_get_raw_",
        ] {
            let _ = case.session.require_byte_addr(sym)?;
        }
        Ok(())
    })
}

#[test]
fn ported_case_02_case_02() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").rtc_raw = RTC_SAMPLE;
        for i in 0..7u16 {
            case.session.write_word_be(u32::from(RTC_BUF + i * 2), 0xffff)?;
        }
        let opts = call_regs(&case.session, &[
            None, None, Some(RTC_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_rtc_get_raw_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        for (i, &b) in RTC_SAMPLE.iter().enumerate() {
            assert_eq!(
                case.session.read_word_be(u32::from(RTC_BUF + (i as u16 * 2)))? & 0xff,
                u16::from(b)
            );
        }
        Ok(())
    })
}

#[test]
fn ported_case_03_case_03() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").temp_raw = TEMP_SAMPLE;
        call_cpu_to_io(
            case,
            "g_bios_temp_get_raw_",
            call_regs(&case.session, &[None; 16]),
        )?;
        case.session.expect_registers(&[
            None, None, Some(0), Some(TEMP_SAMPLE), None, None, Some(0x6666), Some(0x7777),
            None, Some(0x9999), None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_04_case_04() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        {
            let mut st = case.io.state.lock().expect("state lock");
            st.light_raw.clear = LIGHT_SAMPLE[0];
            st.light_raw.red = LIGHT_SAMPLE[1];
            st.light_raw.green = LIGHT_SAMPLE[2];
            st.light_raw.blue = LIGHT_SAMPLE[3];
        }
        for i in 0..4u16 {
            case.session.write_word_be(u32::from(LIGHT_BUF + i * 2), 0)?;
        }
        let opts = call_regs(&case.session, &[
            None, None, Some(LIGHT_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_light_get_raw_", opts)?;
        for (i, &exp) in LIGHT_SAMPLE.iter().enumerate() {
            assert_eq!(
                case.session.read_word_be(u32::from(LIGHT_BUF + (i as u16 * 2)))?,
                exp
            );
        }
        Ok(())
    })
}

#[test]
fn ported_case_05_case_05() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        {
            let mut st = case.io.state.lock().expect("state lock");
            st.distance_raw.distance_mm = DIST_SAMPLE_MM;
            st.distance_raw.range_status = DIST_SAMPLE_STATUS as u8;
        }
        call_cpu_to_io(
            case,
            "g_bios_distance_get_raw_",
            call_regs(&case.session, &[None; 16]),
        )?;
        case.session.expect_registers(&[
            None,
            None,
            Some(0),
            Some(DIST_SAMPLE_MM),
            Some(DIST_SAMPLE_STATUS),
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
