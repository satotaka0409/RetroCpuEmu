use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const RTC_SAMPLE: [u8; 7] = [0x56, 0x34, 0x12, 0x09, 0x04, 0x08, 0x26];
const TEMP_SAMPLE: u16 = 0x1a2b;
const LIGHT_CLEAR: u16 = 0x1234;
const LIGHT_RED: u16 = 0x5678;
const LIGHT_GREEN: u16 = 0x9abc;
const LIGHT_BLUE: u16 = 0xdef0;
const DIST_MM: u16 = 0x3456;
const DIST_STATUS: u8 = 0x1d;

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

fn run_one_request(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    symbol: &str,
    regs: CallRegisters,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            symbol,
            CallOptions {
                registers: Some(regs),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn rtc_raw_returns_7_bytes_to_buffer() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.rtc_raw = RTC_SAMPLE;
        }
        let dst = 0x7000u16;
        for i in 0..7u16 {
            s.write_word(dst + i, 0xffff);
        }

        run_one_request(
            s,
            &mock,
            "g_bios_rtc_get_raw",
            CallRegisters {
                r0: Some(dst),
                ..base_regs()
            },
        )?;

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        for i in 0..7u16 {
            assert_eq!(s.read_word(dst + i), RTC_SAMPLE[i as usize] as u16);
        }
        Ok(())
    })
}

#[test]
fn temp_raw_returns_16bit_in_r1() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.temp_raw = TEMP_SAMPLE;
        }

        run_one_request(s, &mock, "g_bios_temp_get_raw", base_regs())?;

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(TEMP_SAMPLE),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn light_raw_returns_rgbc_words_to_buffer() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.light_raw.clear = LIGHT_CLEAR;
            st.light_raw.red = LIGHT_RED;
            st.light_raw.green = LIGHT_GREEN;
            st.light_raw.blue = LIGHT_BLUE;
        }
        let dst = 0x7010u16;
        for i in 0..4u16 {
            s.write_word(dst + i, 0);
        }

        run_one_request(
            s,
            &mock,
            "g_bios_light_get_raw",
            CallRegisters {
                r0: Some(dst),
                ..base_regs()
            },
        )?;

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(s.read_word(dst), LIGHT_CLEAR);
        assert_eq!(s.read_word(dst + 1), LIGHT_RED);
        assert_eq!(s.read_word(dst + 2), LIGHT_GREEN);
        assert_eq!(s.read_word(dst + 3), LIGHT_BLUE);
        Ok(())
    })
}

#[test]
fn distance_raw_returns_distance_and_status() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        {
            let mut st = mock.state.lock().expect("state lock");
            st.distance_raw.distance_mm = DIST_MM;
            st.distance_raw.range_status = DIST_STATUS;
        }

        run_one_request(s, &mock, "g_bios_distance_get_raw", base_regs())?;

        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r1: Some(DIST_MM),
                r2: Some((DIST_STATUS & 0x1f) as u16),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}
