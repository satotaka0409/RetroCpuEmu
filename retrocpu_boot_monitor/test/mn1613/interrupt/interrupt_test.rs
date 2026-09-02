//! Ported from `interrupt_test.ts` — g_int_init / g_set_int_adr / INT0–3 配送。

use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry,
    FrameworkError, IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession, Mn1613ExecStatus,
    Mn1613CpuRegisterPatch as CpuRegisterPatch,
};

const HANDLER0: u16 = 0x1900;
const HANDLER1: u16 = 0x1910;
const COUNTER0: u16 = 0x1a00;
const COUNTER1: u16 = 0x1a01;
const IDLE: u16 = 0x1800;
const OP_H: u16 = 0x2000;
const OP_RETL: u16 = 0x3f07;
const INC_STUB_PREFIX: u16 = 0x7b07;
const STR_IRQ_ENABLE: u16 = 0x0700;

fn base_regs() -> CallRegisters {
    CallRegisters {
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
    s.reload()?;
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn write_inc_retl_stub(s: &mut Mn1613AsmSession, at: u16, counter: u16) {
    s.write_word(at, INC_STUB_PREFIX);
    s.write_word(at.wrapping_add(1), counter);
    s.write_word(at.wrapping_add(2), 0xe000);
    s.write_word(at.wrapping_add(3), 0x4801);
    s.write_word(at.wrapping_add(4), 0xa000);
    s.write_word(at.wrapping_add(5), OP_RETL);
}

fn set_int_adr(
    s: &mut Mn1613AsmSession,
    slot: u16,
    upper_bits_17_16: u16,
    low_addr: u16,
) -> Result<(), FrameworkError> {
    s.call(
        "g_set_int_adr",
        CallOptions {
            registers: Some(CallRegisters {
                r0: Some(slot),
                r1: Some(upper_bits_17_16),
                r2: Some(low_addr),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            }),
            ..Default::default()
        },
    )?;
    Ok(())
}

fn raise_and_run_to_idle(
    s: &mut Mn1613AsmSession,
    mock: &IoBoardHandshakeMock,
    level: u8,
    cause: Option<u8>,
) -> Result<(), FrameworkError> {
    s.write_word(IDLE, OP_H);
    s.write_word(COUNTER0, 0);
    s.write_word(COUNTER1, 0);
    s.set_cpu_state(&CpuRegisterPatch {
        str: Some(STR_IRQ_ENABLE),
        sp: Some(0xff00),
        csbr: Some(0),
        ssbr: Some(0),
        iisr: Some(0),
        ..Default::default()
    });
    if let Some(c) = cause {
        mock.set_int_cause(c);
    }
    s.trigger_interrupt(level, cause);
    let status = s.run(IDLE)?;
    assert_eq!(status, Mn1613ExecStatus::Halted);
    Ok(())
}

#[test]
fn g_main_after_vector_table_is_all_zero() -> Result<(), FrameworkError> {
    with_case(|s, _| {
        s.expect_label_words("GL_INT0_ADR", &[0; 16])
    })
}

#[test]
fn g_set_int_adr_writes_csbr_and_logical_addr() -> Result<(), FrameworkError> {
    with_case(|s, _| {
        set_int_adr(s, 3, 1, 0x2345)?;
        let base = s.word_addr("GL_INT0_ADR")?;
        assert_eq!(s.read_word(base.wrapping_add(6)), 0x0004);
        assert_eq!(s.read_word(base.wrapping_add(7)), 0x2345);
        s.expect_registers(&base_regs(), None)
    })
}

#[test]
fn g_set_int_adr_r1_r2_zero_clears_slot() -> Result<(), FrameworkError> {
    with_case(|s, _| {
        set_int_adr(s, 0, 0, 0x1111)?;
        set_int_adr(s, 0, 0, 0)?;
        s.expect_label_words("GL_INT0_ADR", &[0, 0])
    })
}

#[test]
fn int2_timer_calls_int2_0_slot_only() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_inc_retl_stub(s, HANDLER0, COUNTER0);
        write_inc_retl_stub(s, HANDLER1, COUNTER1);
        set_int_adr(s, 4, 0, HANDLER0)?;
        set_int_adr(s, 5, 0, HANDLER1)?;
        raise_and_run_to_idle(s, &mock, 2, Some(0))?;
        assert_eq!(s.read_word(COUNTER0), 1);
        assert_eq!(s.read_word(COUNTER1), 0);
        Ok(())
    })
}

#[test]
fn int2_handshake_does_not_call_timer_slot() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_inc_retl_stub(s, HANDLER0, COUNTER0);
        write_inc_retl_stub(s, HANDLER1, COUNTER1);
        set_int_adr(s, 4, 0, HANDLER0)?;
        set_int_adr(s, 5, 0, HANDLER1)?;
        raise_and_run_to_idle(s, &mock, 2, Some(2))?;
        assert_eq!(s.read_word(COUNTER0), 0);
        assert_eq!(s.read_word(COUNTER1), 0);
        Ok(())
    })
}

#[test]
fn int3_handler_balr_and_lpsw3() -> Result<(), FrameworkError> {
    with_case(|s, _| {
        write_inc_retl_stub(s, HANDLER0, COUNTER0);
        set_int_adr(s, 6, 0, HANDLER0)?;
        s.write_word(IDLE, OP_H);
        s.write_word(COUNTER0, 0);
        s.write_word(6, STR_IRQ_ENABLE);
        s.write_word(7, IDLE);
        s.set_cpu_state(&CpuRegisterPatch {
            str: Some(STR_IRQ_ENABLE),
            sp: Some(0xff00),
            csbr: Some(0),
            ssbr: Some(0),
            osr: Some([Some(0), Some(0), Some(0), Some(0)]),
            iisr: Some(0),
            ..Default::default()
        });
        let entry = s.word_addr("g_int3_handler")?;
        let status = s.run(entry)?;
        assert_eq!(status, Mn1613ExecStatus::Halted);
        assert_eq!(s.read_word(COUNTER0), 1);
        Ok(())
    })
}

#[test]
fn int0_calls_normal_slot() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_inc_retl_stub(s, HANDLER0, COUNTER0);
        set_int_adr(s, 0, 0, HANDLER0)?;
        raise_and_run_to_idle(s, &mock, 0, None)?;
        assert_eq!(s.read_word(COUNTER0), 1);
        Ok(())
    })
}
