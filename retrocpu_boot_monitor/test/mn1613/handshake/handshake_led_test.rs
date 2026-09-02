use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const LED_BUF: u16 = 0x1800;
const GL_RND_DEFAULT_SEED: u16 = 0x1234;
const MODE_FREE: u8 = 1;
const SEVEN_SEG: [u8; 12] = [
    0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c,
];
const SEVEN_SEG_ALT: [u8; 12] = [
    0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x11, 0x22, 0x44, 0x88,
];

fn base_regs() -> CallRegisters {
    CallRegisters {
        r2: Some(0x2222),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn handshake_settings() -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![CodeTestIoMockEntry::Handshake]);
    s
}

fn with_case<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession, Arc<IoBoardHandshakeMock>) -> Result<(), FrameworkError>,
{
    let mut s = create_session_from_settings(&handshake_settings(), None)?;
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn write_byte_words(s: &mut Mn1613AsmSession, word_addr: u16, bytes: &[u8]) {
    for (i, b) in bytes.iter().enumerate() {
        s.write_word(word_addr.wrapping_add(i as u16), (*b as u16) & 0x00ff);
    }
}

fn call_led(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    label: &str,
    r0: Option<u16>,
    r1: Option<u16>,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            label,
            CallOptions {
                registers: Some(CallRegisters {
                    r0,
                    r1,
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

fn led_snapshot(mock: &IoBoardHandshakeMock) -> Result<([u8; 12], u8, u8), FrameworkError> {
    let st = mock.state.lock().expect("state lock");
    let led = st
        .led
        .as_ref()
        .ok_or_else(|| FrameworkError::invalid_argument("led state is empty"))?;
    Ok((led.seven_seg, led.bullet_led_0_7, led.bullet_led_8_f))
}

#[test]
fn g_main_initializes_led_latch_to_zero_and_keeps_seed() -> Result<(), FrameworkError> {
    with_case(|s, _mock| {
        assert_eq!(
            s.read_word(s.word_addr("GL_RND_SEED")?),
            GL_RND_DEFAULT_SEED
        );
        let latch = s.word_addr("GL_HSHK_LED_LATCH")?;
        for i in 0..14u16 {
            assert_eq!(s.read_word(latch + i), 0);
        }
        Ok(())
    })
}

#[test]
fn led_display_sends_12digit_and_2bullet_bytes() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.state.lock().expect("state lock").mode = MODE_FREE;
        let mut buf = Vec::from(SEVEN_SEG);
        buf.push(0xab);
        buf.push(0xcd);
        write_byte_words(s, LED_BUF, &buf);

        call_led(s, &mock, "g_bios_led_display_", Some(LED_BUF), None)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;

        let (seven, b0, b1) = led_snapshot(&mock)?;
        assert_eq!(seven, SEVEN_SEG);
        assert_eq!(b0, 0xab);
        assert_eq!(b1, 0xcd);
        Ok(())
    })
}

#[test]
fn led_display_returns_ng_in_monitor_mode() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let mut buf = Vec::from(SEVEN_SEG);
        buf.push(0xab);
        buf.push(0xcd);
        write_byte_words(s, LED_BUF, &buf);

        call_led(s, &mock, "g_bios_led_display_", Some(LED_BUF), None)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                ..Default::default()
            },
            None,
        )?;
        assert!(mock.state.lock().expect("state lock").led.is_none());
        Ok(())
    })
}

#[test]
fn led_seven_seg_can_clear_or_keep_bullet() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.state.lock().expect("state lock").mode = MODE_FREE;
        let mut buf = Vec::from(SEVEN_SEG);
        buf.push(0xab);
        buf.push(0xcd);
        write_byte_words(s, LED_BUF, &buf);
        call_led(s, &mock, "g_bios_led_display_", Some(LED_BUF), None)?;

        write_byte_words(s, LED_BUF, &SEVEN_SEG_ALT);
        call_led(s, &mock, "g_bios_led_seven_seg", Some(LED_BUF), Some(0))?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        let (seven0, b00, b01) = led_snapshot(&mock)?;
        assert_eq!(seven0, SEVEN_SEG_ALT);
        assert_eq!(b00, 0);
        assert_eq!(b01, 0);

        Ok(())
    })
}

#[test]
fn led_seven_seg_can_keep_bullet_when_r1_is_one() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.state.lock().expect("state lock").mode = MODE_FREE;
        let mut buf2 = Vec::from(SEVEN_SEG);
        buf2.push(0x55);
        buf2.push(0xaa);
        write_byte_words(s, LED_BUF, &buf2);
        call_led(s, &mock, "g_bios_led_display_", Some(LED_BUF), None)?;

        write_byte_words(s, LED_BUF, &SEVEN_SEG_ALT);
        call_led(s, &mock, "g_bios_led_seven_seg", Some(LED_BUF), Some(1))?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        let (seven1, b10, b11) = led_snapshot(&mock)?;
        assert_eq!(seven1, SEVEN_SEG_ALT);
        assert_eq!(b10, 0x55);
        assert_eq!(b11, 0xaa);
        Ok(())
    })
}

#[test]
fn led_bullet_updates_bullet_only() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.state.lock().expect("state lock").mode = MODE_FREE;
        let mut buf = Vec::from(SEVEN_SEG);
        buf.push(0xab);
        buf.push(0xcd);
        write_byte_words(s, LED_BUF, &buf);
        call_led(s, &mock, "g_bios_led_display_", Some(LED_BUF), None)?;

        call_led(s, &mock, "g_bios_led_bullet", Some(0x12), Some(0x34))?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                ..Default::default()
            },
            None,
        )?;
        let (seven, b0, b1) = led_snapshot(&mock)?;
        assert_eq!(seven, SEVEN_SEG);
        assert_eq!(b0, 0x12);
        assert_eq!(b1, 0x34);
        Ok(())
    })
}

#[test]
fn led_calls_preserve_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.state.lock().expect("state lock").mode = MODE_FREE;
        let mut buf = Vec::from(SEVEN_SEG);
        buf.push(0x55);
        buf.push(0xaa);
        write_byte_words(s, LED_BUF, &buf);

        call_led(s, &mock, "g_bios_led_display_", Some(LED_BUF), None)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;

        call_led(s, &mock, "g_bios_led_seven_seg", Some(LED_BUF), Some(1))?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;

        call_led(s, &mock, "g_bios_led_bullet", Some(0x01), Some(0x02))?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
