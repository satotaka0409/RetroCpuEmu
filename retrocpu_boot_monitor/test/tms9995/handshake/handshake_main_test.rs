use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{call_handler, with_handshake_case};

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_handshake_interrupt_handler")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_cmd_0x0f_is_ignored_without_reply() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(case, &[0x0f], 0)?;
        assert!(reply.is_empty());
        case.session.expect_registers(&[
            None, None, None, None, None, None, Some(0x6666), Some(0x7777), None, Some(0x9999),
            None, None, None, None, None, None,
        ])
    })
}

#[test]
fn ported_case_03_cmd_0x44_finishes_without_reply() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(case, &[0x44], 0)?;
        assert!(reply.is_empty());
        Ok(())
    })
}

#[test]
fn ported_case_04_cmd_0x12_drains_payload_and_returns_ng() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(case, &[0x12, 0x00, 0x00, 0x02, 0x00, 0x00], 1)?;
        assert_eq!(reply, vec![0x01]);
        Ok(())
    })
}

#[test]
fn ported_case_05_cmd_0x48_finishes_without_reply() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(case, &[0x48], 0)?;
        assert!(reply.is_empty());
        Ok(())
    })
}
