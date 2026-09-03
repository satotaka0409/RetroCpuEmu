use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    break_set_frame, call_handler, plant_hist_entry, write_hist_meta, with_handshake_case,
};

const HDR: usize = 10;
const ENTRY: usize = 78;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_hshk_break_hist_get")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_case_02() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(case, &[0x17, 0x04], HDR + 1)?;
        assert_eq!(reply.len(), HDR + 1);
        assert_eq!(reply[0..HDR], [0; HDR]);
        assert_eq!(reply[HDR], 0x01);
        Ok(())
    })
}

#[test]
fn ported_case_03_case_03() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(0, 0x42, 0, 0x0000_3000, 0),
            1,
        )?;
        let reply = call_handler(case, &[0x17, 0x00], HDR + 1)?;
        assert_eq!(reply[0], 0);
        assert_eq!(reply[1], 0x42);
        assert_eq!(reply[6], 0x30);
        assert_eq!(reply[10], 0x02);
        Ok(())
    })
}

#[test]
fn ported_case_04_case_04() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(0, 0xc2, 4, 0x0000_3000, 0),
            1,
        )?;
        let reply = call_handler(case, &[0x17, 0x00], HDR + 1)?;
        assert_eq!(reply.len(), HDR + 1);
        assert_eq!(reply[0], 0);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(reply[2], 4);
        assert_eq!(reply[10], 0x00);
        Ok(())
    })
}

#[test]
fn ported_case_05_case_05() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(0, 0xc2, 4, 0x0000_3000, 0),
            1,
        )?;
        write_hist_meta(&mut case.session, 0, 1, 1, 0)?;
        plant_hist_entry(&mut case.session, 0, 0, 0x0123);
        let reply = call_handler(case, &[0x17, 0x00], HDR + ENTRY + 1)?;
        assert_eq!(reply[0], 1);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(reply[8], 1);
        assert_eq!(u16::from_be_bytes([reply[HDR], reply[HDR + 1]]), 0x0123);
        assert_eq!(u16::from_be_bytes([reply[HDR + 8], reply[HDR + 9]]), 0xa5a5);
        assert_eq!(*reply.last().unwrap(), 0x00);
        Ok(())
    })
}

#[test]
fn ported_case_06_case_06() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(0, 0xc2, 4, 0x0000_3000, 0),
            1,
        )?;
        write_hist_meta(&mut case.session, 0, 2, 2, 0)?;
        plant_hist_entry(&mut case.session, 0, 0, 0x0001);
        plant_hist_entry(&mut case.session, 0, 1, 0x0002);
        let reply = call_handler(case, &[0x17, 0x00], HDR + ENTRY * 2 + 1)?;
        assert_eq!(reply[0], 2);
        assert_eq!(u16::from_be_bytes([reply[HDR], reply[HDR + 1]]), 0x0001);
        assert_eq!(
            u16::from_be_bytes([reply[HDR + ENTRY], reply[HDR + ENTRY + 1]]),
            0x0002
        );
        assert_eq!(*reply.last().unwrap(), 0x00);
        Ok(())
    })
}

#[test]
fn ported_case_07_case_07() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(3, 0xc2, 4, 0x0000_3000, 0),
            1,
        )?;
        write_hist_meta(&mut case.session, 3, 1, 1, 0)?;
        plant_hist_entry(&mut case.session, 3, 0, 0x7777);
        let reply = call_handler(case, &[0x17, 0x03], HDR + ENTRY + 1)?;
        assert_eq!(reply[0], 1);
        assert_eq!(u16::from_be_bytes([reply[HDR], reply[HDR + 1]]), 0x7777);
        assert_eq!(*reply.last().unwrap(), 0x00);
        Ok(())
    })
}

#[test]
fn ported_case_08_case_08() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(0, 0xc2, 4, 0x0000_3000, 0),
            1,
        )?;
        write_hist_meta(&mut case.session, 0, 1, 1, 1)?;
        plant_hist_entry(&mut case.session, 0, 0, 0x00aa);
        let reply = call_handler(case, &[0x17, 0x00], HDR + ENTRY + 1)?;
        assert_eq!(reply[0], 1);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(case.session.read_word_be(
            case.session.require_byte_addr("GL_BP_HIST_META")? + 4
        )?, 1);
        assert_eq!(u16::from_be_bytes([reply[HDR], reply[HDR + 1]]), 0x00aa);
        assert_eq!(*reply.last().unwrap(), 0x00);
        Ok(())
    })
}

#[test]
fn ported_case_09_case_09() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = call_handler(
            case,
            &break_set_frame(0, 0xc2, 4, 0x0000_3000, 0),
            1,
        )?;
        write_hist_meta(&mut case.session, 0, 4, 4, 0)?;
        for i in 0..4u8 {
            plant_hist_entry(&mut case.session, 0, i, 0x0100 + i as u16);
        }
        let reply = call_handler(case, &[0x17, 0x00], HDR + ENTRY * 4 + 1)?;
        assert_eq!(reply.len(), HDR + ENTRY * 4 + 1);
        assert_eq!(reply[0], 4);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(reply[8], 4);
        assert_eq!(u16::from_be_bytes([reply[HDR], reply[HDR + 1]]), 0x0100);
        assert_eq!(
            u16::from_be_bytes([reply[HDR + ENTRY * 3], reply[HDR + ENTRY * 3 + 1]]),
            0x0103
        );
        assert_eq!(*reply.last().unwrap(), 0x00);
        Ok(())
    })
}
