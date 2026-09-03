use retrocpu_test_framework_rs::JsonTestSettings;

use super::tms9995_handshake_support::{
    call_handler, mem_read_header, with_handshake_case_ext,
};

const BYTE_ADDR: u32 = 0x3000;
const MEMREAD_TEST_BYTES: u32 = 0x0200;

fn mem_settings() -> JsonTestSettings {
    let mut s = super::tms9995_rs_settings();
    s.max_cycles = Some(250_000_000);
    s
}

fn fill_pattern(session: &mut retrocpu_test_framework_rs::framework::tms9995::Tms9995AsmSession, byte_addr: u32, n: u32) -> Vec<u8> {
    let mut data = Vec::with_capacity(n as usize);
    for i in 0..n {
        let b = ((i * 13 + 7) & 0xff) as u8;
        data.push(b);
        let waddr = byte_addr + i * 2;
        session
            .write_byte(waddr, b)
            .expect("write pattern byte");
    }
    data
}

#[test]
fn ported_case_01_cdb() {
    let settings = mem_settings();
    with_handshake_case_ext(&settings, |case| {
        let _ = case.session.require_byte_addr("g_hshk_read_memory")?;
        Ok(())
    })
    .expect("cdb");
}

#[test]
fn ported_case_02_case_02() {
    with_handshake_case_ext(&mem_settings(), |case| {
        case.session.write_word_be(BYTE_ADDR, 0x1234)?;
        case.session.write_word_be(BYTE_ADDR + 2, 0xabcd)?;
        let reply = call_handler(
            case,
            &mem_read_header(BYTE_ADDR, 4),
            4,
        )?;
        assert_eq!(reply[..4], [0x12, 0x34, 0xab, 0xcd]);
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
    .expect("read 4 bytes");
}

#[test]
fn ported_case_03_case_03() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let word = 0x8000u32;
        case.session.write_word_be(word, 0xa5a5)?;
        let reply = call_handler(case, &mem_read_header(word, 2), 2)?;
        assert_eq!(reply[..2], [0xa5, 0xa5]);
        Ok(())
    })
    .expect("read word 8000h");
}

#[test]
fn ported_case_04_case_04() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let reply = call_handler(case, &mem_read_header(BYTE_ADDR, 0), 0)?;
        assert!(reply.is_empty() || reply.len() == 1);
        case.session.expect_registers(&[
            None, None, None, None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
    .expect("read zero bytes");
}

#[test]
fn ported_case_05_case_05() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let n = 256u32;
        let expected = fill_pattern(&mut case.session, BYTE_ADDR, n);
        let reply = call_handler(case, &mem_read_header(BYTE_ADDR, n), n as usize)?;
        assert_eq!(reply[..n as usize], expected);
        Ok(())
    })
    .expect("read 256 bytes");
}

#[test]
fn ported_case_06_case_06() {
    with_handshake_case_ext(&mem_settings(), |case| {
        let expected = fill_pattern(&mut case.session, BYTE_ADDR, MEMREAD_TEST_BYTES);
        let reply = call_handler(
            case,
            &mem_read_header(BYTE_ADDR, MEMREAD_TEST_BYTES),
            MEMREAD_TEST_BYTES as usize,
        )?;
        assert_eq!(reply.len(), MEMREAD_TEST_BYTES as usize);
        assert_eq!(reply, expected);
        Ok(())
    })
    .expect("read 512 bytes");
}
