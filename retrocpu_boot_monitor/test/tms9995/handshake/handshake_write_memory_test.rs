use retrocpu_test_framework_rs::JsonTestSettings;

use super::tms9995_handshake_support::{
    call_handler, mem_write_header, with_handshake_case_ext,
};

const BYTE_ADDR: u32 = 0x3000;

fn mem_settings() -> JsonTestSettings {
    let mut s = super::tms9995_rs_settings();
    s.max_cycles = Some(250_000_000);
    s
}

#[test]
fn ported_case_01_cdb() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let _ = case.session.require_byte_addr("g_hshk_write_memory")?;
        Ok(())
    })
    .expect("cdb");
}

#[test]
fn ported_case_02_case_02() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let mut frame = mem_write_header(BYTE_ADDR, 4);
        frame.extend_from_slice(&[0x12, 0x34, 0xab, 0xcd]);
        let reply = call_handler(case, &frame, 1)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(case.session.read_word_be(BYTE_ADDR)?, 0x1234);
        assert_eq!(case.session.read_word_be(BYTE_ADDR + 2)?, 0xabcd);
        Ok(())
    })
    .expect("write 4 bytes");
}

#[test]
fn ported_case_03_case_03() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let addr = 0x8000u32;
        let mut frame = mem_write_header(addr, 2);
        frame.extend_from_slice(&[0x5a, 0xa5]);
        let reply = call_handler(case, &frame, 1)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(case.session.read_word_be(addr)?, 0x5aa5);
        Ok(())
    })
    .expect("write word 8000h");
}

#[test]
fn ported_case_04_case_04() {
    with_handshake_case_ext(&mem_settings(), |case| {
        case.session.write_word_be(BYTE_ADDR, 0xffff)?;
        let frame = mem_write_header(BYTE_ADDR, 0);
        let reply = call_handler(case, &frame, 1)?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(case.session.read_word_be(BYTE_ADDR)?, 0xffff);
        Ok(())
    })
    .expect("write zero bytes");
}
