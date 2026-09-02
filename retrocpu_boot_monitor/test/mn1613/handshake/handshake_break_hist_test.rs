use std::sync::Arc;
use std::time::{Duration, Instant};

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const HDR: usize = 10;
const ENTRY_SIZE: usize = 66;

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
    s.max_cycles = Some(250_000_000);
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

fn wait_req1(mock: &IoBoardHandshakeMock, timeout: Duration) -> Result<(), FrameworkError> {
    let start = Instant::now();
    loop {
        if mock.wires.lock().expect("wires lock").hshk_in_req == 1 {
            return Ok(());
        }
        if start.elapsed() > timeout {
            return Err(FrameworkError::invalid_argument(
                "timeout waiting hshk_in_req",
            ));
        }
        std::thread::yield_now();
    }
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

fn call_handler(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    to_cpu: &[u8],
    from_cpu_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let frame = to_cpu.to_vec();
    let worker = std::thread::spawn(move || {
        let mut poll = || std::thread::yield_now();
        io.exchange_with_cpu(&frame, from_cpu_len, &mut poll)
    });

    wait_req1(mock, Duration::from_millis(5000))?;
    let _ = s.call(
        "g_handshake_interrupt_handler",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;

    worker
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io worker panicked"))?
}

fn plant_entry(s: &mut Mn1613AsmSession, slot: u8, index: u8, mark: u16) {
    let base = 0x3f000u32 + (slot as u32) * 132 + (index as u32) * 33;
    s.write_word_phys(base, mark);
    s.write_word_phys(base + 1, 0x4567);
    s.write_word_phys(base + 2, 0x89ab);
    s.write_word_phys(base + 3, 0xcdef);
    s.write_word_phys(base + 4, 0xa5a5);
    s.write_word_phys(base + 5, 0x0000);
    for i in 6..33u32 {
        s.write_word_phys(base + i, 0x1000 + i as u16);
    }
}

#[test]
fn break_hist_slot4_returns_header_zero_then_ng() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let reply = call_handler(s, &mock, &[0x17, 0x04], HDR + 1)?;
        assert_eq!(reply, vec![0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01]);
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
fn break_hist_without_hist_setting_returns_count0_and_status_02() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(0, 0x42, 0x00, 0x0000_3000, 0x0000),
            1,
        )?;
        let reply = call_handler(s, &mock, &[0x17, 0x00], HDR + 1)?;

        assert_eq!(reply[0], 0);
        assert_eq!(reply[1], 0x42);
        assert_eq!(reply[2], 0x00);
        assert_eq!(reply[3], 0x00);
        assert_eq!(reply[6], 0x30);
        assert_eq!(reply[7], 0x00);
        assert_eq!(reply[8], 0);
        assert_eq!(reply[9], 0);
        assert_eq!(reply[10], 0x02);
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
fn break_hist_with_hist_setting_and_zero_count_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(0, 0xc2, 0x04, 0x0000_3000, 0x0000),
            1,
        )?;
        let reply = call_handler(s, &mock, &[0x17, 0x00], HDR + 1)?;

        assert_eq!(reply.len(), HDR + 1);
        assert_eq!(reply[0], 0);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(reply[2], 0x04);
        assert_eq!(reply[3], 0x00);
        assert_eq!(reply[8], 0);
        assert_eq!(reply[9], 0);
        assert_eq!(reply[10], 0x00);
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
fn break_hist_returns_one_entry_in_order() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(0, 0xc2, 0x04, 0x0000_3000, 0x0000),
            1,
        )?;
        let meta = s.word_addr("GL_BP_HIST_META")?;
        s.write_word(meta, 1);
        s.write_word(meta + 1, 1);
        s.write_word(meta + 2, 0);
        plant_entry(s, 0, 0, 0x0123);

        let reply = call_handler(s, &mock, &[0x17, 0x00], HDR + ENTRY_SIZE + 1)?;
        assert_eq!(reply[0], 1);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(reply[8], 1);
        assert_eq!(((reply[HDR] as u16) << 8) | reply[HDR + 1] as u16, 0x0123);
        assert_eq!(
            ((reply[HDR + 8] as u16) << 8) | reply[HDR + 9] as u16,
            0xa5a5
        );
        assert_eq!(reply[reply.len() - 1], 0x00);
        Ok(())
    })
}

#[test]
fn break_hist_returns_two_entries_in_order() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(0, 0xc2, 0x04, 0x0000_3000, 0x0000),
            1,
        )?;
        let meta = s.word_addr("GL_BP_HIST_META")?;
        s.write_word(meta, 2);
        s.write_word(meta + 1, 2);
        s.write_word(meta + 2, 0);
        plant_entry(s, 0, 0, 0x0001);
        plant_entry(s, 0, 1, 0x0002);

        let reply = call_handler(s, &mock, &[0x17, 0x00], HDR + ENTRY_SIZE * 2 + 1)?;
        assert_eq!(reply[0], 2);
        assert_eq!(((reply[HDR] as u16) << 8) | reply[HDR + 1] as u16, 0x0001);
        assert_eq!(
            ((reply[HDR + ENTRY_SIZE] as u16) << 8) | reply[HDR + ENTRY_SIZE + 1] as u16,
            0x0002
        );
        assert_eq!(reply[reply.len() - 1], 0x00);
        Ok(())
    })
}

#[test]
fn break_hist_slot3_reads_entry_at_slot_offset() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(3, 0xc2, 0x04, 0x0000_3000, 0x0000),
            1,
        )?;
        let meta = s.word_addr("GL_BP_HIST_META")?.wrapping_add(3 * 3);
        s.write_word(meta, 1);
        s.write_word(meta + 1, 1);
        s.write_word(meta + 2, 0);
        plant_entry(s, 3, 0, 0x7777);

        let reply = call_handler(s, &mock, &[0x17, 0x03], HDR + ENTRY_SIZE + 1)?;
        assert_eq!(reply[0], 1);
        assert_eq!(((reply[HDR] as u16) << 8) | reply[HDR + 1] as u16, 0x7777);
        assert_eq!(reply[reply.len() - 1], 0x00);
        Ok(())
    })
}

#[test]
fn break_hist_overflow_keeps_meta_and_returns_entries() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(0, 0xc2, 0x04, 0x0000_3000, 0x0000),
            1,
        )?;
        let meta = s.word_addr("GL_BP_HIST_META")?;
        s.write_word(meta, 1);
        s.write_word(meta + 1, 1);
        s.write_word(meta + 2, 1);
        plant_entry(s, 0, 0, 0x00aa);

        let reply = call_handler(s, &mock, &[0x17, 0x00], HDR + ENTRY_SIZE + 1)?;
        assert_eq!(reply[0], 1);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(s.read_word(meta + 2), 1);
        assert_eq!(((reply[HDR] as u16) << 8) | reply[HDR + 1] as u16, 0x00aa);
        assert_eq!(reply[reply.len() - 1], 0x00);
        Ok(())
    })
}

#[test]
fn break_hist_returns_four_entries_in_order() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let _ = call_handler(
            s,
            &mock,
            &break_set_frame(0, 0xc2, 0x04, 0x0000_3000, 0x0000),
            1,
        )?;
        let meta = s.word_addr("GL_BP_HIST_META")?;
        s.write_word(meta, 4);
        s.write_word(meta + 1, 4);
        s.write_word(meta + 2, 0);
        for i in 0..4u8 {
            plant_entry(s, 0, i, 0x0100 + i as u16);
        }

        let reply = call_handler(s, &mock, &[0x17, 0x00], HDR + ENTRY_SIZE * 4 + 1)?;
        assert_eq!(reply.len(), HDR + ENTRY_SIZE * 4 + 1);
        assert_eq!(reply[0], 4);
        assert_eq!(reply[1], 0xc2);
        assert_eq!(reply[8], 4);
        assert_eq!(((reply[HDR] as u16) << 8) | reply[HDR + 1] as u16, 0x0100);
        assert_eq!(
            ((reply[HDR + ENTRY_SIZE * 3] as u16) << 8) | reply[HDR + ENTRY_SIZE * 3 + 1] as u16,
            0x0103
        );
        assert_eq!(reply[reply.len() - 1], 0x00);
        Ok(())
    })
}
