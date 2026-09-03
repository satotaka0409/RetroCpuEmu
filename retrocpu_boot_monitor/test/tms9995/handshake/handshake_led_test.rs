use retrocpu_test_framework_rs::FrameworkError;

use super::tms9995_handshake_support::{
    call_cpu_to_io, call_regs, expect_ok_r2, write_byte_buf, with_handshake_case, HSHK_OK,
};

const LED_BUF: u16 = 0x7000;
const MODE_FREE: u16 = 1;
const SEVEN_SEG: [u8; 12] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c];

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let _ = case.session.require_byte_addr("g_bios_led_display_")?;
        let _ = case.session.require_byte_addr("g_bios_led_seven_seg")?;
        let _ = case.session.require_byte_addr("g_bios_led_bullet")?;
        Ok(())
    })
}

#[test]
fn ported_case_02_g_main_14_0() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let seed = case.session.require_byte_addr("GL_RND_SEED")?;
        assert_ne!(case.session.read_word_be(seed)?, 0);
        Ok(())
    })
}

#[test]
fn ported_case_03_display_7seg_12_2b_io() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").mode = MODE_FREE as u8;
        let mut bytes = SEVEN_SEG.to_vec();
        bytes.extend_from_slice(&[0xab, 0xcd]);
        write_byte_buf(&mut case.session, LED_BUF, &bytes);
        let opts = call_regs(&case.session, &[
            None, None, Some(LED_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_led_display_", opts)?;
        case.session.expect_registers(&expect_ok_r2())?;
        let led = case
            .io
            .state
            .lock()
            .expect("state lock")
            .led
            .clone()
            .expect("led state");
        assert_eq!(led.seven_seg, SEVEN_SEG);
        assert_eq!(led.bullet_led_0_7, 0xab);
        assert_eq!(led.bullet_led_8_f, 0xcd);
        Ok(())
    })
}

#[test]
fn ported_case_04_case_04() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        write_byte_buf(&mut case.session, LED_BUF, &[0xff; 14]);
        let opts = call_regs(&case.session, &[
            None, None, Some(LED_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_led_display_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(0x01), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])?;
        assert!(case.io.state.lock().expect("state lock").led.is_none());
        Ok(())
    })
}

#[test]
fn ported_case_05_seven_seg_r1_0_0() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let r = case.session.call("g_bios_led_seven_seg", call_regs(&case.session, &[None; 16]))?;
        assert_eq!(r.registers[2], HSHK_OK);
        Ok(())
    })
}

#[test]
fn ported_case_06_seven_seg_r1_1() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let r = case.session.call("g_bios_led_seven_seg", call_regs(&case.session, &[None; 16]))?;
        assert_eq!(r.registers[2], HSHK_OK);
        Ok(())
    })
}

#[test]
fn ported_case_07_bullet_7seg() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        let r = case.session.call("g_bios_led_bullet", call_regs(&case.session, &[None; 16]))?;
        assert_eq!(r.registers[2], HSHK_OK);
        Ok(())
    })
}

#[test]
fn ported_case_08_r3_r4() -> Result<(), FrameworkError> {
    with_handshake_case(&super::tms9995_rs_settings(), |case| {
        case.io.state.lock().expect("state lock").mode = MODE_FREE as u8;
        write_byte_buf(&mut case.session, LED_BUF, &SEVEN_SEG);
        let opts = call_regs(&case.session, &[
            None, None, Some(LED_BUF), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ]);
        call_cpu_to_io(case, "g_bios_led_display_", opts)?;
        case.session.expect_registers(&[
            None, None, Some(HSHK_OK), None, None, None, Some(0x6666), Some(0x7777), None,
            Some(0x9999), None, None, None, None, None, None,
        ])
    })
}
