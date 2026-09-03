use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    cpu_to_io_bytes, cru_set_in_req, cru_set_out_dena, io_to_cpu_bytes, with_handshake_case,
    HSHK_NG, HSHK_OK,
};

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        for sym in [
            "g_hshk_initiate_send",
            "g_hshk_send_byte",
            "g_hshk_send_word",
            "g_hshk_finalize_send",
            "g_hshk_wait_req1_1",
            "g_hshk_accept_request",
            "g_hshk_recv_byte",
            "g_hshk_finalize_recv",
            "g_hshk_wait_ena_delay",
        ] {
            let _ = case.session.require_byte_addr(sym)?;
        }
        Ok(())
    })
}

#[test]
fn ported_case_02_cpu_to_io_single_byte() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let received = cpu_to_io_bytes(case, &[0xa5])?;
        assert_eq!(received, vec![0xa5]);
        Ok(())
    })
}

#[test]
fn ported_case_03_cpu_to_io_multiple_bytes() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let received = cpu_to_io_bytes(case, &[0x19, 0x01, 0x64])?;
        assert_eq!(received, vec![0x19, 0x01, 0x64]);
        Ok(())
    })
}

#[test]
fn ported_case_04_send_word_big_endian() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let session = &mut case.session;
        let opts = super::tms9995_handshake_support::call_regs(session, &[None; 16]);
        let received = case.io.run_with_cpu_out_capture(2, || {
            let init = session.call("g_hshk_initiate_send", opts.clone())?;
            assert_eq!(init.registers[2], HSHK_OK);
            let sent = session.call(
                "g_hshk_send_word",
                super::tms9995_handshake_support::call_regs(session, &{
                    let mut o = [None; 16];
                    o[2] = Some(0xabcd);
                    o[6] = Some(0x6666);
                    o[7] = Some(0x7777);
                    o[8] = Some(session.return_stub_addr());
                    o[9] = Some(0x9999);
                    o
                }),
            )?;
            assert_eq!(sent.registers[2], HSHK_OK);
            let fin = session.call("g_hshk_finalize_send", opts)?;
            assert_eq!(fin.registers[2], HSHK_OK);
            Ok(())
        })?;
        assert_eq!(received, vec![0xab, 0xcd]);
        Ok(())
    })
}

#[test]
fn ported_case_05_send_byte_without_partner_returns_ng() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let session = &mut case.session;
        let r = session.call(
            "g_hshk_send_byte",
            super::tms9995_handshake_support::call_regs(session, &{
                let mut o = [None; 16];
                o[2] = Some(0x005a);
                o
            }),
        )?;
        assert_eq!(r.registers[2], HSHK_NG);
        Ok(())
    })
}

#[test]
fn ported_case_06_io_to_cpu_single_byte() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let got = io_to_cpu_bytes(case, &[0xc3])?;
        assert_eq!(got, vec![0xc3]);
        Ok(())
    })
}

#[test]
fn ported_case_07_io_to_cpu_two_bytes() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let got = io_to_cpu_bytes(case, &[0x48, 0xab])?;
        assert_eq!(got, vec![0x48, 0xab]);
        Ok(())
    })
}

#[test]
fn ported_case_08_wait_req1_ok_when_set() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        cru_set_in_req(case, 1);
        let r = case.session.call(
            "g_hshk_wait_req1_1",
            super::tms9995_handshake_support::call_regs(&case.session, &[None; 16]),
        )?;
        assert_eq!(r.registers[2], HSHK_OK);
        Ok(())
    })
}

#[test]
fn ported_case_09_wait_req1_ng_when_clear() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        cru_set_in_req(case, 0);
        let r = case.session.call(
            "g_hshk_wait_req1_1",
            super::tms9995_handshake_support::call_regs(&case.session, &[None; 16]),
        )?;
        assert_eq!(r.registers[2], HSHK_NG);
        Ok(())
    })
}

#[test]
fn ported_case_10_finalize_recv_clears_ena() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        cru_set_out_dena(case, 1);
        let r = case.session.call(
            "g_hshk_finalize_recv",
            super::tms9995_handshake_support::call_regs(&case.session, &[None; 16]),
        )?;
        assert_eq!(r.registers[2], HSHK_OK);
        assert_eq!(
            case.io
                .cru
                .lock()
                .expect("cru lock")
                .io_read_signal(0x0021)
                .expect("read"),
            0
        );
        Ok(())
    })
}

#[test]
fn ported_case_11_wait_ena_delay_advances_seed() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let seed_addr = case.session.require_byte_addr("GL_RND_SEED")?;
        let seed_before = case.session.read_word_be(seed_addr)?;
        let _ = case.session.call(
            "g_hshk_wait_ena_delay",
            super::tms9995_handshake_support::call_regs(&case.session, &[None; 16]),
        )?;
        let seed_after = case.session.read_word_be(seed_addr)?;
        assert_ne!(seed_after, seed_before);
        assert!(seed_after >= 1);
        case.session.expect_registers(&[
            None, None, None, None, None, None, Some(0x6666), Some(0x7777), None, Some(0x9999),
            None, None, None, None, None, None,
        ])
    })
}
