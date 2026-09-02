use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    JsonTestSettings, Mn1613AsmSession,
};

const SLOT_WORDS: u16 = 6;
const WATCH_WORD: u16 = 0x1800;
const WATCH_BYTE: u16 = WATCH_WORD * 2;
const FLAGS_INST_RD: u16 = 0x42;
const FLAGS_MEM_COND_EQ: u16 = 0x08;
const IO_BREAK_HIT: u16 = 0x0033;
const IO_BREAK_PREV: u16 = 0x0034;

fn base_regs() -> CallRegisters {
    CallRegisters {
        r2: Some(0x2222),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn settings_with_ports(hit: u16, prev: u16) -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![
        CodeTestIoMockEntry::PortRead {
            port: IO_BREAK_HIT,
            value: hit,
        },
        CodeTestIoMockEntry::PortRead {
            port: IO_BREAK_PREV,
            value: prev,
        },
    ]);
    s
}

fn with_session<F>(hit: u16, prev: u16, f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession) -> Result<(), FrameworkError>,
{
    let mut s = create_session_from_settings(&settings_with_ports(hit, prev), None)?;
    f(&mut s)
}

fn write_slot(s: &mut Mn1613AsmSession, slot: u16, words: [u16; 6]) -> Result<(), FrameworkError> {
    let base = s
        .word_addr("GL_HSHK_ADDR_BREAK")?
        .wrapping_add(slot * SLOT_WORDS);
    for (i, w) in words.iter().enumerate() {
        s.write_word(base.wrapping_add(i as u16), *w);
    }
    Ok(())
}

fn call_breakpoint_handler(s: &mut Mn1613AsmSession) -> Result<u16, FrameworkError> {
    let r = s.call(
        "g_breakpoint_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;
    Ok(r.registers.r[0])
}

#[test]
fn int1_break_io_kind_decrements_count_and_continues() -> Result<(), FrameworkError> {
    with_session(0x0000, 0x1234, |s| {
        write_slot(s, 0, [1, 0x01, 2, 0, WATCH_BYTE, 0])?;
        let r0 = call_breakpoint_handler(s)?;
        assert_eq!(r0, 0);
        let base = s.word_addr("GL_HSHK_ADDR_BREAK")?;
        assert_eq!(s.read_word(base + 2), 1);
        Ok(())
    })
}

#[test]
fn case_02_enabled_slot_decrements_count_and_continues() -> Result<(), FrameworkError> {
    with_session(0x0000, 0xabcd, |s| {
        write_slot(s, 0, [1, FLAGS_INST_RD, 2, 0, WATCH_BYTE, 0])?;
        let r0 = call_breakpoint_handler(s)?;
        assert_eq!(r0, 0);

        let base = s.word_addr("GL_HSHK_ADDR_BREAK")?;
        assert_eq!(s.read_word(base + 2), 1);
        s.expect_registers(
            &CallRegisters {
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn case_03_disabled_slot_does_not_change_count() -> Result<(), FrameworkError> {
    with_session(0x0000, 0xabcd, |s| {
        write_slot(s, 0, [0, FLAGS_INST_RD, 2, 0, WATCH_BYTE, 0])?;
        let r0 = call_breakpoint_handler(s)?;
        assert_eq!(r0, 0);

        let base = s.word_addr("GL_HSHK_ADDR_BREAK")?;
        assert_eq!(s.read_word(base + 2), 2);
        Ok(())
    })
}

#[test]
fn start_0x1800_3_mem_cond_mismatch_keeps_count() -> Result<(), FrameworkError> {
    with_session(0x0000, 0xabcd, |s| {
        s.write_word(WATCH_WORD, 0x2222);
        write_slot(s, 0, [1, FLAGS_MEM_COND_EQ, 2, 0, WATCH_BYTE, 0x1111])?;

        let r0 = call_breakpoint_handler(s)?;
        assert_eq!(r0, 0);

        let base = s.word_addr("GL_HSHK_ADDR_BREAK")?;
        assert_eq!(s.read_word(base + 2), 2);
        Ok(())
    })
}
