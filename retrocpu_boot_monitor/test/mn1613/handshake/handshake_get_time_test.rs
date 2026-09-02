use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const SAMPLE_TIME: u64 = 0x0123_4567_89ab_cdef;
const SAMPLE_WORDS: [u16; 4] = [0x0123, 0x4567, 0x89ab, 0xcdef];

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
    mock.set_timestamp_u64(SAMPLE_TIME);
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn call_get_time(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
) -> Result<(), FrameworkError> {
    mock.run_with_cpu_to_io_request(|| {
        let _ = s.call(
            "g_hshk_get_time_",
            CallOptions {
                registers: Some(base_regs()),
                stack: Some(vec![0, 0, 0, 0]),
                ..Default::default()
            },
        )?;
        Ok(())
    })?;
    Ok(())
}

#[test]
fn get_time_writes_64bit_time_into_stack_words() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_get_time(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        s.expect_stack_work(&retrocpu_test_framework_rs::mn1613::StackWorkExpect {
            offset: 2,
            words: SAMPLE_WORDS.to_vec(),
        })
    })
}

#[test]
fn get_time_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        call_get_time(s, &mock)?;
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
