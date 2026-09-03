use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ok_r2, with_handshake_case, HSHK_OK,
};

const BEEP_HZ: u16 = 880;
const BEEP_MS: u16 = 200;

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_beep_")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_beep_880hz_200ms_is_sent_to_io_mock() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let session = &case.session;
        let opts = call_regs(session, &[
            None, None, None, None, Some(BEEP_HZ), Some(BEEP_MS), Some(0x6666), Some(0x7777),
            None, Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_beep_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(HSHK_OK), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])?;
        let state = case.io.state.lock().expect("state lock");
        let beep = state
            .last_beep
            .as_ref()
            .ok_or_else(|| FrameworkError::invalid_argument("last_beep was not recorded"))?;
        assert_eq!(beep.frequency_hz, BEEP_HZ);
        assert_eq!(beep.duration_ms, BEEP_MS);
        Ok(())
    })
}

#[test]
fn ported_case_03_beep_frequency_zero_is_accepted_as_stop() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let session = &case.session;
        let opts = call_regs(session, &[
            None, None, None, None, Some(0), Some(100), Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_beep_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        let beep = case
            .io
            .state
            .lock()
            .expect("state lock")
            .last_beep
            .clone()
            .expect("last_beep");
        assert_eq!(beep.frequency_hz, 0);
        assert_eq!(beep.duration_ms, 100);
        Ok(())
    })
}

#[test]
fn ported_case_04_beep_preserves_r6_r7_r9() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let session = &case.session;
        let opts = call_regs(session, &[
            None, None, None, None, Some(BEEP_HZ), Some(BEEP_MS), Some(0x6666), Some(0x7777),
            None, Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_beep_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(HSHK_OK), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
