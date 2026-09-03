use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{call_handler, with_handshake_case};

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_hshk_read_io")?;
        let _ = case.session.require_byte_addr("g_hshk_write_io")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_case_02() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let reply = call_handler(
            case,
            &[0x15, 0x00, 0x00, 0xa0, 0x02, 0x00],
            3,
        )?;
        assert_eq!(reply.len(), 3);
        assert_eq!(reply[2], 0);
        case.session.expect_registers(&[
            None, None, Some(0), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
