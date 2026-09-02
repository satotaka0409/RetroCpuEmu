//! Ported from `interrupt_break_test.ts` — g_breakpoint_interrupt_handler / 1Ah / 履歴。

use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession, Mn1613CpuRegisterPatch as CpuRegisterPatch,
    Mn1613ExecStatus,
};

const SLOT_WORDS: u16 = 6;
const IDLE: u16 = 0x1b00;
const OP_H: u16 = 0x2000;
const STR_IRQ_ENABLE: u16 = 0x0700;
const WATCH_WORD: u16 = 0x1800;
const WATCH_BYTE: u16 = 0x3000;
const FLAGS_EQ: u16 = 0x08;
const FLAGS_WR: u16 = 0x04;
const FLAGS_RD: u16 = 0x02;
const FLAGS_HIST: u16 = 0x80;
const BP_COND_EQ: u16 = 1;
const BP_COND_NE: u16 = 2;
const BP_COND_GE: u16 = 3;
const BP_COND_LE: u16 = 4;
const BP_COND_AND_NZ: u16 = 5;
const BP_COND_AND_Z: u16 = 6;
const BP_COND_UNDEF: u16 = 7;
const PREV_WR: u16 = 0xbeef;
const AFTER_WR: u16 = 0xcafe;
const HIST_SBR: u16 = 0x0c;
const HIST_LOG: u16 = 0xf000;
const HIST_ENTRY_WORDS: u16 = 33;
const HIST_SLOT_WORDS: u16 = 4 * HIST_ENTRY_WORDS;
const SAMPLE_TIME: u64 = 0x0123_4567_89ab_cdef;
const SAMPLE_TIME_WORDS: [u16; 4] = [0x0123, 0x4567, 0x89ab, 0xcdef];
const OP_B_SELF: u16 = 0xcfff;
const HIST_ENTRY_BYTES: usize = 66;
const HIST_HDR_BYTES: usize = 10;
const FLAGS_INST: u16 = 0x40;
const FLAGS_IO: u16 = 0x01;

fn base_regs() -> CallRegisters {
    CallRegisters {
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn settings_with_hit(hit: u16, prev: u16) -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.max_cycles = Some(20_000_000);
    s.io_mock = Some(vec![
        CodeTestIoMockEntry::Handshake,
        CodeTestIoMockEntry::PortRead {
            port: 0x33,
            value: hit,
        },
        CodeTestIoMockEntry::PortRead {
            port: 0x34,
            value: prev,
        },
    ]);
    s
}

fn with_case<F>(settings: &JsonTestSettings, f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession, Arc<IoBoardHandshakeMock>) -> Result<(), FrameworkError>,
{
    let mut s = create_session_from_settings(settings, None)?;
    s.reload()?;
    s.run_init()?;
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn phys_word(log_addr: u16, sbr: u16) -> u32 {
    (((sbr & 0x0f) as u32) << 14) + log_addr as u32
}

fn hist_entry_phys(slot: u16, index: u16) -> u32 {
    phys_word(
        HIST_LOG + slot * HIST_SLOT_WORDS + index * HIST_ENTRY_WORDS,
        HIST_SBR,
    )
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

fn cond_flags(cond: u16) -> u16 {
    (cond & 7) << 3
}

fn call_handler(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    to_cpu: &[u8],
    from_cpu_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    mock.run_io_handler_exchange(to_cpu, from_cpu_len, || {
        let _ = s.call(
            "g_handshake_interrupt_handler",
            CallOptions {
                registers: Some(CallRegisters {
                    str_reg: Some(0),
                    r3: Some(0x3333),
                    r4: Some(0x4444),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        Ok(())
    })
}

fn be16(buf: &[u8], off: usize) -> u16 {
    ((buf[off] as u16) << 8) | buf[off + 1] as u16
}

fn call_break_handler(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
) -> Result<(), FrameworkError> {
    let serve = mock.start_serve();
    let result = s.call(
        "g_breakpoint_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    );
    serve.stop();
    result.map(|_| ())
}

fn append_hist_io(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
) -> Result<(), FrameworkError> {
    let serve = mock.start_serve();
    let result = s.call(
        "g_breakpoint_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    );
    serve.stop();
    result.map(|_| ())
}

fn run_with_break_serve(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    entry: u16,
) -> Result<Mn1613ExecStatus, FrameworkError> {
    let serve = mock.start_serve();
    let status = s.run(entry)?;
    serve.stop();
    Ok(status)
}

#[test]
fn port_33_unmapped_passes_through_r0_0() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0xffff, 0), |s, mock| {
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn slot0_disabled_passes_through() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        write_slot(s, 0, [0, 0, 0, 0, WATCH_BYTE, 0])?;
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn slot0_enabled_sends_1ah_r0_1() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        write_slot(s, 0, [1, 0, 0, 0, WATCH_BYTE, 0])?;
        call_break_handler(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 1);
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.history_count, 0);
        assert_eq!(notify.addr, WATCH_BYTE as u32);
        Ok(())
    })
}

#[test]
fn history_full_stop_sends_1ah_with_count_4() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        write_slot(s, 0, [1, FLAGS_HIST, 0, 0, WATCH_BYTE, 0])?;
        let meta = s.word_addr("GL_BP_HIST_META")?;
        s.write_word(meta, 4);
        s.write_word(meta + 1, 0);
        s.write_word(meta + 2, 1);

        call_break_handler(s, &mock)?;

        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.flags, FLAGS_HIST as u8);
        assert_eq!(notify.history_count, 4);
        assert_eq!(notify.addr, WATCH_BYTE as u32);
        Ok(())
    })
}

#[test]
fn value_compare_mismatch_passes_through() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        s.write_word(WATCH_WORD, 0xaaaa);
        write_slot(s, 0, [1, FLAGS_EQ, 0, 0, WATCH_BYTE, 0x1234])?;
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn count2_first_hit_decrements_and_continues() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        write_slot(s, 0, [1, 0, 2, 0, WATCH_BYTE, 0])?;
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        let base = s.word_addr("GL_HSHK_ADDR_BREAK")?;
        assert_eq!(s.read_word(base + 2), 1);
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn slot3_user_comparator_sends_1ah() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(3, 0), |s, mock| {
        write_slot(s, 3, [1, 0, 0, 0, WATCH_BYTE, 0])?;
        call_break_handler(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 1);
        assert_eq!(notify.slot, 3);
        assert_eq!(notify.addr, WATCH_BYTE as u32);
        Ok(())
    })
}

#[test]
fn no_hist_write_count2_continues_without_meta() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        write_slot(s, 0, [1, FLAGS_WR, 2, 0, WATCH_BYTE, 0])?;
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        assert_eq!(s.read_word(s.word_addr("GL_BP_HIST_META")?), 0);
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn hist_write_stores_after_prev_to_3f000h() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        mock.set_timestamp_u64(SAMPLE_TIME);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 0, [1, FLAGS_WR | FLAGS_HIST, 2, 0, WATCH_BYTE, 0])?;
        append_hist_io(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        assert_eq!(s.read_word(s.word_addr("GL_BP_HIST_META")?), 1);
        let ent = hist_entry_phys(0, 0);
        s.expect_memory_words_phys(ent, &[
            SAMPLE_TIME_WORDS[0],
            SAMPLE_TIME_WORDS[1],
            SAMPLE_TIME_WORDS[2],
            SAMPLE_TIME_WORDS[3],
            AFTER_WR,
            PREV_WR,
        ])?;
        assert_eq!(s.read_word_phys(ent + 9), 0x3333);
        assert_eq!(s.read_word_phys(ent + 10), 0x4444);
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn hist_read_prev_is_zero() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        mock.set_timestamp_u64(SAMPLE_TIME);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 0, [1, FLAGS_RD | FLAGS_HIST, 2, 0, WATCH_BYTE, 0])?;
        append_hist_io(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        let ent = hist_entry_phys(0, 0);
        assert_eq!(s.read_word_phys(ent + 4), AFTER_WR);
        assert_eq!(s.read_word_phys(ent + 5), 0);
        assert_eq!(s.read_word_phys(ent + 9), 0x3333);
        assert_eq!(s.read_word_phys(ent + 10), 0x4444);
        Ok(())
    })
}

#[test]
fn hist_mismatch_does_not_write_history() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        s.write_word(WATCH_WORD, 0xaaaa);
        write_slot(
            s,
            0,
            [1, FLAGS_EQ | FLAGS_HIST, 0, 0, WATCH_BYTE, 0x1234],
        )?;
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        assert_eq!(s.read_word(s.word_addr("GL_BP_HIST_META")?), 0);
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

struct ReadMismatchCase {
    #[allow(dead_code)]
    name: &'static str,
    cond: u16,
    access: u16,
    data: u16,
}

const READ_MISMATCH: &[ReadMismatchCase] = &[
    ReadMismatchCase {
        name: "eq",
        cond: BP_COND_EQ,
        access: 0xaaaa,
        data: 0x1234,
    },
    ReadMismatchCase {
        name: "ne",
        cond: BP_COND_NE,
        access: 0x1234,
        data: 0x1234,
    },
    ReadMismatchCase {
        name: "ge_pos",
        cond: BP_COND_GE,
        access: 0x0001,
        data: 0x0010,
    },
    ReadMismatchCase {
        name: "ge_neg",
        cond: BP_COND_GE,
        access: 0xfffe,
        data: 0xffff,
    },
    ReadMismatchCase {
        name: "le_pos",
        cond: BP_COND_LE,
        access: 0x0010,
        data: 0x0001,
    },
    ReadMismatchCase {
        name: "le_neg",
        cond: BP_COND_LE,
        access: 0xffff,
        data: 0xfffe,
    },
    ReadMismatchCase {
        name: "and_nz",
        cond: BP_COND_AND_NZ,
        access: 0x00ff,
        data: 0xff00,
    },
    ReadMismatchCase {
        name: "and_z",
        cond: BP_COND_AND_Z,
        access: 0x00f0,
        data: 0x00ff,
    },
    ReadMismatchCase {
        name: "undef7",
        cond: BP_COND_UNDEF,
        access: 0x1234,
        data: 0x1234,
    },
];

#[test]
fn mem_read_cond_mismatch_eq() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[0])
}

#[test]
fn mem_read_cond_mismatch_ne() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[1])
}

#[test]
fn mem_read_cond_mismatch_ge_pos() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[2])
}

#[test]
fn mem_read_cond_mismatch_ge_neg() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[3])
}

#[test]
fn mem_read_cond_mismatch_le_pos() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[4])
}

#[test]
fn mem_read_cond_mismatch_le_neg() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[5])
}

#[test]
fn mem_read_cond_mismatch_and_nz() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[6])
}

#[test]
fn mem_read_cond_mismatch_and_z() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[7])
}

#[test]
fn mem_read_cond_mismatch_undef7() -> Result<(), FrameworkError> {
    read_mismatch_case(&READ_MISMATCH[8])
}

fn read_mismatch_case(c: &ReadMismatchCase) -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        s.write_word(WATCH_WORD, c.access);
        write_slot(
            s,
            0,
            [
                1,
                FLAGS_RD | cond_flags(c.cond) | FLAGS_HIST,
                0,
                0,
                WATCH_BYTE,
                c.data,
            ],
        )?;
        s.call(
            "g_breakpoint_interrupt_handler",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
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
        assert_eq!(s.read_word(s.word_addr("GL_BP_HIST_META")?), 0);
        assert!(mock.last_break_notify().is_none());
        Ok(())
    })
}

#[test]
fn int1_break_halts_at_main_loop_h() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        write_slot(s, 0, [1, 0, 0, 0, WATCH_BYTE, 0])?;
        s.write_word(IDLE, OP_H);
        s.set_cpu_state(&CpuRegisterPatch {
            str: Some(STR_IRQ_ENABLE),
            sp: Some(0xff00),
            csbr: Some(0),
            ssbr: Some(0),
            iisr: Some(0),
            ..Default::default()
        });
        mock.set_int_cause(0);
        s.trigger_interrupt(1, Some(0));
        let status = run_with_break_serve(s, &mock, IDLE)?;
        assert_eq!(status, Mn1613ExecStatus::Halted);
        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 1);
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.addr, WATCH_BYTE as u32);
        let ic = s.cpu_state().ic & 0xffff;
        assert_eq!(s.read_word(ic.wrapping_sub(1)), OP_H);
        Ok(())
    })
}

#[test]
fn call_inst_hist_stop_sends_1ah() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        let flags = FLAGS_INST | FLAGS_RD | FLAGS_HIST;
        write_slot(s, 0, [1, flags, 0, 0, WATCH_BYTE, 0])?;
        mock.set_timestamp_u64(SAMPLE_TIME);
        call_break_handler(s, &mock)?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(1),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 0);
        assert_eq!(notify.history_count, 1);
        Ok(())
    })
}

#[test]
fn start_inst_break_stops_and_hist_registers() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        let test_regs = [0x1111u16, 0x2222, 0x1234, 0x3333, 0x4444];
        let flags = FLAGS_INST | FLAGS_RD | FLAGS_HIST;
        write_slot(s, 0, [1, flags, 0, 0, WATCH_BYTE, 0])?;
        mock.set_timestamp_u64(SAMPLE_TIME);
        s.write_word(WATCH_WORD, OP_B_SELF);
        s.set_cpu_state(&CpuRegisterPatch {
            r: Some([
                Some(test_regs[0]),
                Some(test_regs[1]),
                Some(test_regs[2]),
                Some(test_regs[3]),
                Some(test_regs[4]),
            ]),
            str: Some(STR_IRQ_ENABLE),
            sp: Some(0xff00),
            csbr: Some(0),
            ssbr: Some(0),
            iisr: Some(0),
            ..Default::default()
        });
        mock.set_int_cause(0);
        s.trigger_interrupt(1, Some(0));
        let status = run_with_break_serve(s, &mock, WATCH_WORD)?;
        assert_eq!(status, Mn1613ExecStatus::Halted);

        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 0);
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.addr, WATCH_BYTE as u32);

        mock.reset_handshake_activity();
        let hist = call_handler(
            s,
            &mock,
            &[0x17, 0x00],
            HIST_HDR_BYTES + HIST_ENTRY_BYTES + 1,
        )?;
        let ent = HIST_HDR_BYTES;
        assert_eq!(hist[0], 1);
        assert_eq!(hist[1], flags as u8);
        assert_eq!(be16(&hist, ent + 10), 0);
        assert_eq!(be16(&hist, ent + 18), test_regs[3]);
        assert_eq!(be16(&hist, ent + 20), (0xff00u16).wrapping_sub(8));
        assert_eq!(be16(&hist, ent + 22), 0xff00);
        Ok(())
    })
}

#[test]
fn start_mem_write_break_stops_and_hist_prev() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        let test_regs = [0xaaaau16, 0xbbbb, 0xcccc, 0x3333, 0x4444];
        let flags = FLAGS_WR | FLAGS_HIST;
        write_slot(s, 0, [1, flags, 0, 0, WATCH_BYTE, 0])?;
        mock.set_timestamp_u64(SAMPLE_TIME);
        s.write_word(WATCH_WORD, AFTER_WR);
        s.set_cpu_state(&CpuRegisterPatch {
            r: Some([
                Some(test_regs[0]),
                Some(test_regs[1]),
                Some(test_regs[2]),
                Some(test_regs[3]),
                Some(test_regs[4]),
            ]),
            str: Some(STR_IRQ_ENABLE),
            sp: Some(0xff00),
            csbr: Some(0),
            ssbr: Some(0),
            iisr: Some(0),
            ..Default::default()
        });
        mock.set_int_cause(0);
        s.trigger_interrupt(1, Some(0));
        let status = run_with_break_serve(s, &mock, WATCH_WORD)?;
        assert_eq!(status, Mn1613ExecStatus::Halted);

        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 1);
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.addr, WATCH_BYTE as u32);

        let hist = call_handler(
            s,
            &mock,
            &[0x17, 0x00],
            HIST_HDR_BYTES + HIST_ENTRY_BYTES + 1,
        )?;
        let ent = HIST_HDR_BYTES;
        assert_eq!(hist[0], 1);
        assert_eq!(hist[1], flags as u8);
        assert_eq!(be16(&hist, ent + 10), PREV_WR);
        assert_eq!(be16(&hist, ent + 18), test_regs[3]);
        Ok(())
    })
}

#[test]
fn start_io_read_break_stops_and_hist() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, 0), |s, mock| {
        let test_regs = [0x1357u16, 0x2468, 0xabcd, 0x3333, 0x4444];
        let flags = FLAGS_IO | FLAGS_RD | FLAGS_HIST;
        write_slot(s, 0, [1, flags, 0, 0, WATCH_BYTE, 0])?;
        mock.set_timestamp_u64(SAMPLE_TIME);
        s.write_word(WATCH_WORD, OP_B_SELF);
        s.set_cpu_state(&CpuRegisterPatch {
            r: Some([
                Some(test_regs[0]),
                Some(test_regs[1]),
                Some(test_regs[2]),
                Some(test_regs[3]),
                Some(test_regs[4]),
            ]),
            str: Some(STR_IRQ_ENABLE),
            sp: Some(0xff00),
            csbr: Some(0),
            ssbr: Some(0),
            iisr: Some(0),
            ..Default::default()
        });
        mock.set_int_cause(0);
        s.trigger_interrupt(1, Some(0));
        let status = run_with_break_serve(s, &mock, WATCH_WORD)?;
        assert_eq!(status, Mn1613ExecStatus::Halted);

        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 2);
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.addr, WATCH_BYTE as u32);

        let hist = call_handler(
            s,
            &mock,
            &[0x17, 0x00],
            HIST_HDR_BYTES + HIST_ENTRY_BYTES + 1,
        )?;
        let ent = HIST_HDR_BYTES;
        assert_eq!(hist[0], 1);
        assert_eq!(hist[1], flags as u8);
        assert_eq!(be16(&hist, ent + 10), 0);
        assert_eq!(be16(&hist, ent + 18), test_regs[3]);
        assert_eq!(be16(&hist, ent + 20), (0xff00u16).wrapping_sub(8));
        assert_eq!(be16(&hist, ent + 22), 0xff00);
        Ok(())
    })
}

#[test]
fn start_io_write_break_stops_and_hist_prev() -> Result<(), FrameworkError> {
    with_case(&settings_with_hit(0, PREV_WR), |s, mock| {
        let test_regs = [0x0f0fu16, 0xf0f0, 0x55aa, 0x3333, 0x4444];
        let flags = FLAGS_IO | FLAGS_WR | FLAGS_HIST;
        write_slot(s, 0, [1, flags, 0, 0, WATCH_BYTE, 0])?;
        mock.set_timestamp_u64(SAMPLE_TIME);
        s.write_word(WATCH_WORD, AFTER_WR);
        s.set_cpu_state(&CpuRegisterPatch {
            r: Some([
                Some(test_regs[0]),
                Some(test_regs[1]),
                Some(test_regs[2]),
                Some(test_regs[3]),
                Some(test_regs[4]),
            ]),
            str: Some(STR_IRQ_ENABLE),
            sp: Some(0xff00),
            csbr: Some(0),
            ssbr: Some(0),
            iisr: Some(0),
            ..Default::default()
        });
        mock.set_int_cause(0);
        s.trigger_interrupt(1, Some(0));
        let status = run_with_break_serve(s, &mock, WATCH_WORD)?;
        assert_eq!(status, Mn1613ExecStatus::Halted);

        let notify = mock
            .last_break_notify()
            .ok_or_else(|| FrameworkError::invalid_argument("missing break notify"))?;
        assert_eq!(notify.kind, 2);
        assert_eq!(notify.slot, 0);
        assert_eq!(notify.addr, WATCH_BYTE as u32);

        let hist = call_handler(
            s,
            &mock,
            &[0x17, 0x00],
            HIST_HDR_BYTES + HIST_ENTRY_BYTES + 1,
        )?;
        let ent = HIST_HDR_BYTES;
        assert_eq!(hist[0], 1);
        assert_eq!(hist[1], flags as u8);
        assert_eq!(be16(&hist, ent + 10), PREV_WR);
        assert_eq!(be16(&hist, ent + 18), test_regs[3]);
        Ok(())
    })
}
