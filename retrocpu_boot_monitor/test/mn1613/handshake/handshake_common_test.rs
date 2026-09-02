use std::sync::Arc;
use std::time::{Duration, Instant};

use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, CodeTestIoMockEntry, FrameworkError,
    IoBoardHandshakeMock, JsonTestSettings, Mn1613AsmSession,
};

const HSHK_OK: u16 = 0x00;
const HSHK_NG: u16 = 0x01;

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

fn collect_cpu_frame(
    mock: &IoBoardHandshakeMock,
    expected_len: usize,
) -> Result<Vec<u8>, FrameworkError> {
    let mut frame = Vec::with_capacity(expected_len);
    let start = Instant::now();
    while frame.len() < expected_len {
        if let Some(chunk) = mock.take_cpu_to_io_frame() {
            frame.extend(chunk);
            continue;
        }
        if start.elapsed() > Duration::from_millis(2000) {
            return Err(FrameworkError::invalid_argument(
                "timeout collecting cpu_to_io frame",
            ));
        }
        std::thread::yield_now();
    }
    frame.truncate(expected_len);
    Ok(frame)
}

fn cpu_to_io_bytes(
    s: &mut Mn1613AsmSession,
    mock: &IoBoardHandshakeMock,
    bytes: &[u8],
) -> Result<Vec<u8>, FrameworkError> {
    let init = s.call(
        "g_hshk_initiate_send",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;
    assert_eq!(init.registers.r[0], HSHK_OK);

    for b in bytes {
        let sent = s.call(
            "g_hshk_send_byte",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(*b as u16),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(sent.registers.r[0], HSHK_OK);
    }

    let fin = s.call(
        "g_hshk_finalize_send",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;
    assert_eq!(fin.registers.r[0], HSHK_OK);

    collect_cpu_frame(mock, bytes.len())
}

fn io_to_cpu_bytes(
    s: &mut Mn1613AsmSession,
    mock: &Arc<IoBoardHandshakeMock>,
    bytes: &[u8],
) -> Result<Vec<u8>, FrameworkError> {
    let io = Arc::clone(mock);
    let payload = bytes.to_vec();
    let feeder = std::thread::spawn(move || {
        let mut poll = || std::thread::yield_now();
        io.exchange_with_cpu(&payload, 0, &mut poll)
    });

    wait_req1(mock, Duration::from_millis(5000))?;

    let wait = s.call(
        "g_hshk_wait_req1_1",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;
    assert_eq!(wait.registers.r[0], HSHK_OK);

    let acc = s.call(
        "g_hshk_accept_request",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;
    assert_eq!(acc.registers.r[0], HSHK_OK);

    let mut got = Vec::with_capacity(bytes.len());
    for _ in 0..bytes.len() {
        let rec = s.call(
            "g_hshk_recv_byte",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(rec.registers.r[0], HSHK_OK);
        got.push((rec.registers.r[1] & 0xff) as u8);
    }

    let fin = s.call(
        "g_hshk_finalize_recv",
        CallOptions {
            registers: Some(base_regs()),
            ..Default::default()
        },
    )?;
    assert_eq!(fin.registers.r[0], HSHK_OK);

    let _ = feeder
        .join()
        .map_err(|_| FrameworkError::invalid_argument("io feeder panicked"))??;

    Ok(got)
}

#[test]
fn cpu_to_io_single_byte_arrives_with_initiate_send_finalize() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let received = cpu_to_io_bytes(s, &mock, &[0xa5])?;
        assert_eq!(received, vec![0xa5]);
        {
            let w = mock.wires.lock().expect("wires lock");
            assert_eq!(w.hshk_out_dena, 0);
            assert_eq!(w.hshk_in_req, 0);
        }
        s.expect_registers(
            &CallRegisters {
                r0: Some(HSHK_OK),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn cpu_to_io_multiple_bytes_arrive_in_order() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let received = cpu_to_io_bytes(s, &mock, &[0x19, 0x01, 0x64])?;
        assert_eq!(received, vec![0x19, 0x01, 0x64]);
        s.expect_registers(
            &CallRegisters {
                r0: Some(HSHK_OK),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn send_word_sends_big_endian_two_bytes() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let init = s.call(
            "g_hshk_initiate_send",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(init.registers.r[0], HSHK_OK);

        let sent = s.call(
            "g_hshk_send_word",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(0xabcd),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(sent.registers.r[0], HSHK_OK);

        let fin = s.call(
            "g_hshk_finalize_send",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(fin.registers.r[0], HSHK_OK);

        let received = collect_cpu_frame(&mock, 2)?;
        assert_eq!(received, vec![0xab, 0xcd]);
        s.expect_registers(
            &CallRegisters {
                r0: Some(HSHK_OK),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn initiate_send_returns_ng_when_ena_is_already_1() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.wires.lock().expect("wires lock").hshk_out_dena = 1;
        let r = s.call(
            "g_hshk_initiate_send",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], HSHK_NG);
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
fn send_byte_without_partner_returns_ng() -> Result<(), FrameworkError> {
    with_case(|s, _mock| {
        let r = s.call(
            "g_hshk_send_byte",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(0x005a),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], HSHK_NG);
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
fn io_to_cpu_single_byte_is_received_in_r1() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let got = io_to_cpu_bytes(s, &mock, &[0xc3])?;
        assert_eq!(got, vec![0xc3]);
        {
            let w = mock.wires.lock().expect("wires lock");
            assert_eq!(w.hshk_out_dena, 0);
            assert_eq!(w.hshk_in_req, 0);
        }
        s.expect_registers(
            &CallRegisters {
                r0: Some(HSHK_OK),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn io_to_cpu_two_bytes_are_received_in_order() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        let got = io_to_cpu_bytes(s, &mock, &[0x48, 0xab])?;
        assert_eq!(got, vec![0x48, 0xab]);
        s.expect_registers(
            &CallRegisters {
                r0: Some(HSHK_OK),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn wait_req1_returns_ok_when_req_is_1() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.wires.lock().expect("wires lock").hshk_in_req = 1;
        let r = s.call(
            "g_hshk_wait_req1_1",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], HSHK_OK);
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
fn wait_req1_returns_ng_when_req_does_not_come() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.wires.lock().expect("wires lock").hshk_in_req = 0;
        let r = s.call(
            "g_hshk_wait_req1_1",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], HSHK_NG);
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
fn finalize_recv_clears_ena_and_returns_ok() -> Result<(), FrameworkError> {
    with_case(|s, mock| {
        mock.wires.lock().expect("wires lock").hshk_out_dena = 1;
        let r = s.call(
            "g_hshk_finalize_recv",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], HSHK_OK);
        assert_eq!(mock.wires.lock().expect("wires lock").hshk_out_dena, 0);
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
fn wait_ena_delay_advances_seed_and_preserves_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s, _mock| {
        let seed_addr = s.word_addr("GL_RND_SEED")?;
        let seed_before = s.read_word(seed_addr);
        let _ = s.call(
            "g_hshk_wait_ena_delay",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        let seed_after = s.read_word(seed_addr);
        assert_ne!(seed_after, seed_before);
        assert!(seed_after >= 1);
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
