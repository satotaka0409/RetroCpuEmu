use std::sync::Arc;

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const SLOT_WORDS: u16 = 6;
const WATCH_WORD: u16 = 0x1800;
const WATCH_BYTE: u16 = 0x3000;
const AFTER_WR: u16 = 0xcafe;
const PREV_WR: u16 = 0xbeef;
const KIND_MEM: u16 = 1;
const KIND_IO: u16 = 2;
const FLAGS_WR: u16 = 0x04;
const FLAGS_RD: u16 = 0x02;
const FLAGS_INST: u16 = 0x40;
const FLAGS_IO: u16 = 0x01;
const HIST_SBR: u16 = 0x0c;
const HIST_LOG: u16 = 0xf000;
const HIST_ENTRY_WORDS: u16 = 33;
const HIST_SLOT_WORDS: u16 = 4 * HIST_ENTRY_WORDS;
const HIST_DEPTH: u16 = 4;
const SNAP_BASE: u16 = 0x1900;
const SNAP_R3: u16 = 0x3333;
const SNAP_R4: u16 = 0x4444;
const INT1_STR_SAVE: u16 = 2;
const INT1_IC_SAVE: u16 = 3;
const SAMPLE_TIME: u64 = 0x0123_4567_89ab_cdef;

fn handshake_settings() -> JsonTestSettings {
    let mut s = super::mn1613_rs_settings();
    s.io_mock = Some(vec![CodeTestIoMockEntry::Handshake]);
    s
}

fn with_session<F>(f: F) -> Result<(), FrameworkError>
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

fn phys_word(log_addr: u16, sbr: u16) -> u32 {
    (((sbr & 0x0f) as u32) << 14) + log_addr as u32
}

fn hist_entry_phys(slot: u16, index: u16) -> u32 {
    phys_word(
        HIST_LOG + slot.wrapping_mul(HIST_SLOT_WORDS) + index.wrapping_mul(HIST_ENTRY_WORDS),
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

fn write_snap(s: &mut Mn1613AsmSession, prev: u16) -> u16 {
    s.write_word(SNAP_BASE, prev);
    s.write_word(SNAP_BASE + 1, SNAP_R3);
    s.write_word(SNAP_BASE + 2, SNAP_R4);
    s.write_word(SNAP_BASE + 3, 0);
    s.write_word(SNAP_BASE + 4, 0);
    s.write_word(SNAP_BASE + 5, 0);
    SNAP_BASE
}

fn append_once(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    kind: u16,
    slot: u16,
    snap: u16,
) -> Result<(), FrameworkError> {
    let table = s
        .word_addr("GL_HSHK_ADDR_BREAK")?
        .wrapping_add(slot * SLOT_WORDS);

    let io = Arc::clone(mock);
    let worker = std::thread::spawn(move || {
        let mut poll = || {};
        io.handle_one_request(&mut poll)
    });

    s.call(
        "g_bp_hist_append",
        CallOptions {
            registers: Some(CallRegisters {
                r0: Some(snap),
                r2: Some(kind),
                r3: Some(slot),
                r4: Some(table),
                ..Default::default()
            }),
            ..Default::default()
        },
    )?;

    let io_result = worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;
    if io_result.is_empty() {
        return Err(FrameworkError::invalid_argument(
            "empty 11h response from handshake mock",
        ));
    }
    Ok(())
}

#[test]
fn write_stores_after_prev_and_updates_meta() -> Result<(), FrameworkError> {
    with_session(|s, mock| {
        s.write_word(INT1_STR_SAVE, 0x0700);
        s.write_word(INT1_IC_SAVE, WATCH_WORD + 1);
        let snap = write_snap(s, PREV_WR);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 0, [1, FLAGS_WR, 0, 0, WATCH_BYTE, 0])?;

        append_once(s, &mock, KIND_MEM, 0, snap)?;

        let meta = s.word_addr("GL_BP_HIST_META")?;
        assert_eq!(s.read_word(meta), 1);
        assert_eq!(s.read_word(meta + 1), 1);
        assert_eq!(s.read_word(meta + 2), 0);

        let ent = hist_entry_phys(0, 0);
        s.expect_memory_words_phys(ent, &[0x0123, 0x4567, 0x89ab, 0xcdef, AFTER_WR, PREV_WR])?;
        assert_eq!(s.read_word_phys(ent + 9), SNAP_R3);
        assert_eq!(s.read_word_phys(ent + 10), SNAP_R4);
        Ok(())
    })
}

#[test]
fn slot3_writes_to_slot_offset_area() -> Result<(), FrameworkError> {
    with_session(|s, mock| {
        let snap = write_snap(s, PREV_WR);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 3, [1, FLAGS_WR, 0, 0, WATCH_BYTE, 0])?;

        append_once(s, &mock, KIND_MEM, 3, snap)?;

        let meta = s.word_addr("GL_BP_HIST_META")?.wrapping_add(3 * 3);
        assert_eq!(s.read_word(meta), 1);
        s.expect_memory_words_phys(
            hist_entry_phys(3, 0),
            &[0x0123, 0x4567, 0x89ab, 0xcdef, AFTER_WR, PREV_WR],
        )
    })
}

#[test]
fn read_or_inst_path_sets_prev_to_zero() -> Result<(), FrameworkError> {
    with_session(|s, mock| {
        let snap = write_snap(s, PREV_WR);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 0, [1, FLAGS_RD | FLAGS_INST, 0, 0, WATCH_BYTE, 0])?;

        append_once(s, &mock, 0, 0, snap)?;

        let ent = hist_entry_phys(0, 0);
        assert_eq!(s.read_word_phys(ent + 4), AFTER_WR);
        assert_eq!(s.read_word_phys(ent + 5), 0);
        Ok(())
    })
}

#[test]
fn io_kind_sets_after_to_zero() -> Result<(), FrameworkError> {
    with_session(|s, mock| {
        let snap = write_snap(s, 0);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 0, [1, FLAGS_IO | FLAGS_WR, 0, 0, WATCH_BYTE, 0])?;

        append_once(s, &mock, KIND_IO, 0, snap)?;

        let ent = hist_entry_phys(0, 0);
        assert_eq!(s.read_word_phys(ent + 4), 0);
        Ok(())
    })
}

#[test]
fn fifth_entry_keeps_depth_sets_overflow_and_overwrites_index0() -> Result<(), FrameworkError> {
    with_session(|s, mock| {
        let snap = write_snap(s, PREV_WR);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 0, [1, FLAGS_WR, 0, 0, WATCH_BYTE, 0])?;

        let meta = s.word_addr("GL_BP_HIST_META")?;
        s.write_word(meta, HIST_DEPTH);
        s.write_word(meta + 1, 0);
        s.write_word(meta + 2, 0);
        s.write_word_phys(hist_entry_phys(0, 0), 0x1111);

        append_once(s, &mock, KIND_MEM, 0, snap)?;

        assert_eq!(s.read_word(meta), HIST_DEPTH);
        assert_eq!(s.read_word(meta + 1), 1);
        assert_eq!(s.read_word(meta + 2), 1);
        assert_eq!(s.read_word_phys(hist_entry_phys(0, 0)), 0x0123);
        Ok(())
    })
}

#[test]
fn preserves_r2_r3_r4() -> Result<(), FrameworkError> {
    with_session(|s, mock| {
        let snap = write_snap(s, 0);
        s.write_word(WATCH_WORD, AFTER_WR);
        write_slot(s, 1, [1, FLAGS_RD, 0, 0, WATCH_BYTE, 0])?;
        let table = s.word_addr("GL_HSHK_ADDR_BREAK")?.wrapping_add(SLOT_WORDS);

        let io = Arc::clone(&mock);
        let worker = std::thread::spawn(move || {
            let mut poll = || {};
            io.handle_one_request(&mut poll)
        });

        let r = s.call(
            "g_bp_hist_append",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(snap),
                    r2: Some(KIND_MEM),
                    r3: Some(1),
                    r4: Some(table),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;

        let _ = worker
            .join()
            .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))??;

        assert_eq!(r.registers.r[2], KIND_MEM);
        assert_eq!(r.registers.r[3], 1);
        assert_eq!(r.registers.r[4], table);
        Ok(())
    })
}
