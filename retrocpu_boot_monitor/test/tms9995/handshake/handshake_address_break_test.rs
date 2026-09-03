use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    break_set_frame, call_handler, read_slot_words, with_handshake_case, write_slot_words,
};

const SLOT_COUNT: u16 = 4;
const FLAGS_WRITE_HIST: u16 = 0x22;
const HIT_COUNT: u16 = 3;
const BREAK_ADDR: u32 = 0x0000_3000;
const BREAK_DATA: u16 = 0x1234;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_hshk_addr_break_set")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_g_main_after_4_slots_are_zero() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        for slot in 0..SLOT_COUNT {
            assert_eq!(read_slot_words(&case.session, slot as u8)?, [0, 0, 0, 0, 0, 0]);
        }
        Ok(())
    })
}

#[test]
fn ported_case_03_cmd_10h_sets_slot0_and_returns_ok() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(
            case,
            &break_set_frame(
                0,
                FLAGS_WRITE_HIST as u8,
                HIT_COUNT as u8,
                BREAK_ADDR,
                BREAK_DATA,
            ),
            1,
        )?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(
            read_slot_words(&case.session, 0)?,
            [
                1,
                FLAGS_WRITE_HIST,
                HIT_COUNT,
                ((BREAK_ADDR >> 16) & 0xffff) as u16,
                (BREAK_ADDR & 0xffff) as u16,
                BREAK_DATA,
            ]
        );
        Ok(())
    })
}

#[test]
fn ported_case_04_cmd_10h_can_set_slot3() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(case, &break_set_frame(3, 0x01, 0, 0x0000_0020, 0x00ab), 1)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(read_slot_words(&case.session, 3)?, [1, 0x01, 0, 0x0000, 0x0020, 0x00ab]);
        Ok(())
    })
}

#[test]
fn ported_case_05_cmd_10h_slot4_returns_ng_and_keeps_table() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        write_slot_words(&mut case.session, 0, [1, 0x22, 3, 0, 0x3000, 0x1234])?;
        write_slot_words(&mut case.session, 3, [1, 0x01, 2, 0, 0x0020, 0x00ab])?;
        let before0 = read_slot_words(&case.session, 0)?;
        let before3 = read_slot_words(&case.session, 3)?;
        let reply = call_handler(
            case,
            &break_set_frame(
                4,
                FLAGS_WRITE_HIST as u8,
                HIT_COUNT as u8,
                BREAK_ADDR,
                BREAK_DATA,
            ),
            1,
        )?;
        assert_eq!(reply, vec![0x01]);
        assert_eq!(read_slot_words(&case.session, 0)?, before0);
        assert_eq!(read_slot_words(&case.session, 3)?, before3);
        Ok(())
    })
}

#[test]
fn ported_case_06_cmd_11h_clears_target_slot_and_keeps_other_slots() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        write_slot_words(
            &mut case.session,
            0,
            [1, FLAGS_WRITE_HIST, HIT_COUNT, 0x0000, 0x3000, BREAK_DATA],
        )?;
        write_slot_words(&mut case.session, 1, [1, 0x00, 1, 0x0000, 0x1800, 0x5555])?;
        let before1 = read_slot_words(&case.session, 1)?;
        let reply = call_handler(case, &[0x11, 0x00], 1)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(read_slot_words(&case.session, 0)?, [0, 0, 0, 0, 0, 0]);
        assert_eq!(read_slot_words(&case.session, 1)?, before1);
        Ok(())
    })
}

#[test]
fn ported_case_07_cmd_11h_slot4_returns_ng() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        write_slot_words(
            &mut case.session,
            0,
            [1, FLAGS_WRITE_HIST, HIT_COUNT, 0x0000, 0x3000, BREAK_DATA],
        )?;
        let reply = call_handler(case, &[0x11, 0x04], 1)?;
        assert_eq!(reply, vec![0x01]);
        assert_eq!(read_slot_words(&case.session, 0)?[0], 1);
        Ok(())
    })
}

#[test]
fn ported_case_08_keeps_r6_r7_r9_across_10h_and_11h() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(case, &break_set_frame(2, 0x20, 0, 0x0000_abcd, 0x1111), 1)?;
        case.session.expect_registers(&[
            None, None, None, None, None, None, Some(0x6666), Some(0x7777), None, Some(0x9999),
            None, None, None, None, None, None,
        ])?;
        let _ = call_handler(case, &[0x11, 0x02], 1)?;
        case.session.expect_registers(&[
            None, None, None, None, None, None, Some(0x6666), Some(0x7777), None, Some(0x9999),
            None, None, None, None, None, None,
        ])
    })
}
