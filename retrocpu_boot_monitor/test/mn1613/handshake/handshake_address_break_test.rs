use std::sync::Arc;
use std::time::{Duration, Instant};

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const SLOT_WORDS: u16 = 6;
const SLOT_COUNT: u16 = 4;
const FLAGS_WRITE_HIST: u16 = 0x22;
const HIT_COUNT: u16 = 3;
const BREAK_ADDR: u32 = 0x0000_3000;
const BREAK_DATA: u16 = 0x1234;

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
    let mock = s.require_handshake_mock()?;
    let ret = f(&mut s, Arc::clone(&mock));
    s.detach_io_mock();
    ret
}

fn break_set_frame(slot: u8, flags: u8, count: u8, addr: u32, data: u16) -> Vec<u8> {
    vec![
        0x10,
        slot,
        flags,
        count,
        ((addr >> 24) & 0xff) as u8,
        ((addr >> 16) & 0xff) as u8,
        ((addr >> 8) & 0xff) as u8,
        (addr & 0xff) as u8,
        ((data >> 8) & 0xff) as u8,
        (data & 0xff) as u8,
    ]
}

fn read_slot(s: &Mn1613AsmSession, slot: u16) -> Result<[u16; 6], FrameworkError> {
    let base = s
        .word_addr("GL_HSHK_ADDR_BREAK")?
        .wrapping_add(slot * SLOT_WORDS);
    Ok([
        s.read_word(base),
        s.read_word(base + 1),
        s.read_word(base + 2),
        s.read_word(base + 3),
        s.read_word(base + 4),
        s.read_word(base + 5),
    ])
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

fn call_handler(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    to_cpu: &[u8],
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let frame = to_cpu.to_vec();
    let feeder = std::thread::spawn(move || feed_io_to_cpu_frame(&io, &frame));

    let _ = s.call(
        "g_handshake_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;

    feeder
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io feeder panicked"))??;

    Ok(mock.take_cpu_to_io_frame().unwrap_or_default())
}

fn wait_wire<P>(
    mock: &IoBoardHandshakeMock,
    timeout: Duration,
    pred: P,
) -> Result<(), FrameworkError>
where
    P: Fn(u8) -> bool,
{
    let start = Instant::now();
    loop {
        let dack = mock.wires.lock().expect("wires lock").hshk_in_dack;
        if pred(dack) {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err(FrameworkError::invalid_argument("handshake feeder timeout"));
        }
        std::thread::yield_now();
    }
}

fn feed_io_to_cpu_frame(mock: &IoBoardHandshakeMock, data: &[u8]) -> Result<(), FrameworkError> {
    let timeout = Duration::from_millis(2000);
    {
        let mut w = mock.wires.lock().expect("wires lock");
        w.hshk_in_req = 1;
        w.hshk_in_dena = 0;
        w.hshk_in_data = 0;
    }

    let mut i = 0usize;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };

        {
            let mut w = mock.wires.lock().expect("wires lock");
            w.hshk_in_data = b0;
            w.hshk_in_dena = 1;
        }
        wait_wire(mock, timeout, |dack| dack != 0)?;

        {
            let mut w = mock.wires.lock().expect("wires lock");
            w.hshk_in_data = b1;
            w.hshk_in_dena = 0;
        }
        wait_wire(mock, timeout, |dack| dack == 0)?;
        i += 2;
    }

    mock.wires.lock().expect("wires lock").hshk_in_req = 0;
    Ok(())
}

#[test]
fn g_main_after_4_slots_are_zero() -> Result<(), FrameworkError> {
    with_case(|s, _| {
        for slot in 0..SLOT_COUNT {
            assert_eq!(read_slot(s, slot)?, [0, 0, 0, 0, 0, 0]);
        }
        Ok(())
    })
}

#[test]
fn cmd_10h_sets_slot0_and_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(
            s,
            &mock,
            &break_set_frame(
                0,
                FLAGS_WRITE_HIST as u8,
                HIT_COUNT as u8,
                BREAK_ADDR,
                BREAK_DATA,
            ),
        )?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(
            read_slot(s, 0)?,
            [
                1,
                FLAGS_WRITE_HIST,
                HIT_COUNT,
                ((BREAK_ADDR >> 16) & 0xffff) as u16,
                (BREAK_ADDR & 0xffff) as u16,
                BREAK_DATA,
            ]
        );
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn cmd_10h_can_set_slot3() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(s, &mock, &break_set_frame(3, 0x01, 0, 0x0000_0020, 0x00ab))?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(read_slot(s, 3)?, [1, 0x01, 0, 0x0000, 0x0020, 0x00ab]);
        Ok(())
    })
}

#[test]
fn cmd_10h_slot4_returns_ng_and_keeps_table() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_slot(s, 0, [1, 0x22, 3, 0, 0x3000, 0x1234])?;
        write_slot(s, 3, [1, 0x01, 2, 0, 0x0020, 0x00ab])?;
        let before0 = read_slot(s, 0)?;
        let before3 = read_slot(s, 3)?;

        let reply = call_handler(
            s,
            &mock,
            &break_set_frame(
                4,
                FLAGS_WRITE_HIST as u8,
                HIT_COUNT as u8,
                BREAK_ADDR,
                BREAK_DATA,
            ),
        )?;
        assert_eq!(reply, vec![0x01]);
        assert_eq!(read_slot(s, 0)?, before0);
        assert_eq!(read_slot(s, 3)?, before3);
        Ok(())
    })
}

#[test]
fn cmd_11h_clears_target_slot_and_keeps_other_slots() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_slot(
            s,
            0,
            [1, FLAGS_WRITE_HIST, HIT_COUNT, 0x0000, 0x3000, BREAK_DATA],
        )?;
        write_slot(s, 1, [1, 0x00, 1, 0x0000, 0x1800, 0x5555])?;
        let before1 = read_slot(s, 1)?;

        let reply = call_handler(s, &mock, &[0x11, 0x00])?;
        assert_eq!(reply, vec![0x00]);
        assert_eq!(read_slot(s, 0)?, [0, 0, 0, 0, 0, 0]);
        assert_eq!(read_slot(s, 1)?, before1);
        Ok(())
    })
}

#[test]
fn cmd_11h_slot4_returns_ng() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        write_slot(
            s,
            0,
            [1, FLAGS_WRITE_HIST, HIT_COUNT, 0x0000, 0x3000, BREAK_DATA],
        )?;
        let reply = call_handler(s, &mock, &[0x11, 0x04])?;
        assert_eq!(reply, vec![0x01]);
        assert_eq!(read_slot(s, 0)?[0], 1);
        Ok(())
    })
}

#[test]
fn keeps_r3_r4_across_10h_and_11h() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(s, &mock, &break_set_frame(2, 0x20, 0, 0x0000_abcd, 0x1111))?;
        s.expect_registers(
            &CallRegisters {
                r0: Some(0),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;

        let _ = call_handler(s, &mock, &[0x11, 0x02])?;
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
