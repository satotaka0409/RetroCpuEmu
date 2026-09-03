use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ok_r2, with_handshake_case,
};

const SAMPLE_TIME: u64 = 0x0123_4567_89ab_cdef;
const SAMPLE_WORDS: [u16; 4] = [0x0123, 0x4567, 0x89ab, 0xcdef];
const BUF: u16 = 0x7000;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_hshk_get_time_")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_get_time_writes_64bit_to_buffer() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.set_timestamp_u64(SAMPLE_TIME);
        for i in 0..4u16 {
            case.session
                .write_word_be(u32::from(BUF + i * 2), 0xffff)?;
        }
        let opts = call_regs(&case.session, &[
            None, None, Some(BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_hshk_get_time_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        for (i, &exp) in SAMPLE_WORDS.iter().enumerate() {
            assert_eq!(
                case.session.read_word_be(u32::from(BUF) + (i as u32) * 2)?,
                exp
            );
        }
        Ok(())
    })
}

#[test]
fn ported_case_03_get_time_preserves_r6_r7_r9() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.set_timestamp_u64(SAMPLE_TIME);
        let opts = call_regs(&case.session, &[
            None, None, Some(BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_hshk_get_time_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
