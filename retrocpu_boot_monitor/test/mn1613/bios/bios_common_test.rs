use std::path::PathBuf;

use retrocpu_test_framework_rs::types::{AsmCpuType, CpuLogMode};
use retrocpu_test_framework_rs::{
    create_session_from_settings, CallOptions, CallRegisters, FrameworkError, JsonTestSettings,
    Mn1613AsmSession,
};

const HEAP_START: u16 = 0x1800;
const HEAP2_LOG: u16 = 0x1800;
const HEAP2_SBR: u16 = 4;
const HEAP_HDR: u16 = 2;
const HEAP_USED: u16 = 1;
const GL_RND_TAP: u16 = 0xb400;
const GL_RND_DEFAULT_SEED: u16 = 0x1234;
const CPY_SRC: u16 = 0x1800;
const CPY_DST: u16 = 0x1900;
const CPY_WORDS: [u16; 4] = [0x1111, 0x2222, 0x3333, 0x4444];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .to_path_buf()
}

fn mn1613_rs_settings() -> JsonTestSettings {
    let root = repo_root();
    let hex = root
        .join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.ihx")
        .to_string_lossy()
        .to_string();
    let cdb = root
        .join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.cdb")
        .to_string_lossy()
        .to_string();

    JsonTestSettings {
        name: "mn1613_mon_rs".to_string(),
        cpu: AsmCpuType::Mn1613,
        hex_file: hex,
        cdb_file: cdb,
        init_label: Some("g_main".to_string()),
        io_mock: None,
        cpu_log_file: None,
        cpu_log_mode: None,
        max_cycles: Some(2_000_000),
    }
}

fn monitor_artifact_exists() -> bool {
    let root = repo_root();
    let hex = root.join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.ihx");
    let cdb = root.join("retrocpu_boot_monitor/build/hex_rs/mn1613/mn1613_mon_rs.cdb");
    if !hex.is_file() || !cdb.is_file() {
        eprintln!(
            "skip: missing monitor artifact: {} / {}",
            hex.display(),
            cdb.display()
        );
        return false;
    }
    true
}

fn with_case<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Mn1613AsmSession) -> Result<(), FrameworkError>,
{
    if !monitor_artifact_exists() {
        return Ok(());
    }
    let mut session = create_session_from_settings(&mn1613_rs_settings(), None)?;
    session.reload()?;
    session.run_init()?;
    f(&mut session)
}

fn base_regs() -> CallRegisters {
    CallRegisters {
        r1: Some(0x1111),
        r2: Some(0x2222),
        r3: Some(0x3333),
        r4: Some(0x4444),
        ..Default::default()
    }
}

fn phys_word(log_addr: u16, sbr: u16) -> u32 {
    (((sbr & 0xf) as u32) << 14) + (log_addr as u32)
}

fn phys_to_cpy_args(phys: u32) -> (u16, u16) {
    let p = phys & 0x3ffff;
    (((p >> 16) & 0x3) as u16, (p & 0xffff) as u16)
}

fn expect_mem_cpy_phys(
    s: &mut Mn1613AsmSession,
    src_phys: u32,
    dst_phys: u32,
) -> Result<(), FrameworkError> {
    let (src_a17, src_log) = phys_to_cpy_args(src_phys);
    let (dst_a17, dst_log) = phys_to_cpy_args(dst_phys);

    for (i, w) in CPY_WORDS.iter().enumerate() {
        s.write_word_phys(src_phys + i as u32, *w);
        s.write_word_phys(dst_phys + i as u32, 0xdead);
    }

    let mut regs = base_regs();
    regs.r0 = Some(src_a17);
    regs.r1 = Some(src_log);
    regs.r2 = Some(CPY_WORDS.len() as u16);
    s.call(
        "g_mem_cpy",
        CallOptions {
            registers: Some(regs),
            stack: Some(vec![dst_log, dst_a17]),
            ..Default::default()
        },
    )?;

    s.expect_memory_words_phys(dst_phys, &CPY_WORDS)?;
    s.expect_memory_words_phys(src_phys, &CPY_WORDS)
}

fn lfsr_step(seed: u16) -> u16 {
    let mut x = if seed == 0 { 1 } else { seed };
    let lsb = x & 1;
    x >>= 1;
    if lsb != 0 {
        x ^= GL_RND_TAP;
    }
    x
}

fn lfsr_sequence(seed: u16, count: usize) -> Vec<u16> {
    let mut out = Vec::with_capacity(count);
    let mut x = seed;
    for _ in 0..count {
        x = lfsr_step(x);
        out.push(x);
    }
    out
}

fn read_seed(s: &Mn1613AsmSession) -> Result<u16, FrameworkError> {
    Ok(s.read_word(s.word_addr("GL_RND_SEED")?))
}

#[test]
fn g_rnd_init_zero_sets_seed_to_one() -> Result<(), FrameworkError> {
    with_case(|s| {
        let mut regs = base_regs();
        regs.r0 = Some(0);
        let r = s.call(
            "g_rnd_init",
            CallOptions {
                registers: Some(regs),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], 1);
        assert_eq!(read_seed(s)?, 1);
        s.expect_registers(
            &CallRegisters {
                r1: Some(0x1111),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn g_rnd_init_non_zero_keeps_seed() -> Result<(), FrameworkError> {
    with_case(|s| {
        let mut regs = base_regs();
        regs.r0 = Some(0xabcd);
        let r = s.call(
            "g_rnd_init",
            CallOptions {
                registers: Some(regs),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], 0xabcd);
        assert_eq!(read_seed(s)?, 0xabcd);
        Ok(())
    })
}

#[test]
fn g_get_rnd_matches_lfsr_step() -> Result<(), FrameworkError> {
    with_case(|s| {
        let mut init = base_regs();
        init.r0 = Some(GL_RND_DEFAULT_SEED);
        s.call(
            "g_rnd_init",
            CallOptions {
                registers: Some(init),
                ..Default::default()
            },
        )?;
        let expected = lfsr_step(GL_RND_DEFAULT_SEED);
        let r = s.call(
            "g_get_rnd",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], expected);
        assert_eq!(read_seed(s)?, expected);
        Ok(())
    })
}

#[test]
fn g_get_rnd_10_times_matches_lfsr_sequence() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.set_cpu_log_mode(Some(CpuLogMode::Checkpoint));
        let mut init = base_regs();
        init.r0 = Some(GL_RND_DEFAULT_SEED);
        s.call(
            "g_rnd_init",
            CallOptions {
                registers: Some(init),
                ..Default::default()
            },
        )?;

        let expected = lfsr_sequence(GL_RND_DEFAULT_SEED, 10);
        let mut actual = Vec::new();
        for _ in 0..10 {
            let r = s.call(
                "g_get_rnd",
                CallOptions {
                    registers: Some(base_regs()),
                    ..Default::default()
                },
            )?;
            actual.push(r.registers.r[0]);
        }
        assert_eq!(actual, expected);
        assert_eq!(read_seed(s)?, expected[9]);
        s.set_cpu_log_mode(None);
        Ok(())
    })
}

#[test]
fn g_get_rnd_from_zero_seed_starts_from_one() -> Result<(), FrameworkError> {
    with_case(|s| {
        let seed_addr = s.word_addr("GL_RND_SEED")?;
        s.write_word(seed_addr, 0);
        let expected = lfsr_step(0);
        let r = s.call(
            "g_get_rnd",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        assert_eq!(r.registers.r[0], expected);
        assert_eq!(read_seed(s)?, expected);
        assert_eq!(expected, 0xb400);
        Ok(())
    })
}

#[test]
fn g_get_rnd_preserves_r1_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_get_rnd",
            CallOptions {
                registers: Some(base_regs()),
                ..Default::default()
            },
        )?;
        s.expect_registers(
            &CallRegisters {
                r1: Some(0x1111),
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn g_mem_cpy_same_segment_copy() -> Result<(), FrameworkError> {
    with_case(|s| {
        for (i, w) in CPY_WORDS.iter().enumerate() {
            s.write_word(CPY_SRC.wrapping_add(i as u16), *w);
            s.write_word(CPY_DST.wrapping_add(i as u16), 0xdead);
        }
        let mut regs = base_regs();
        regs.r0 = Some(0);
        regs.r1 = Some(CPY_SRC);
        regs.r2 = Some(CPY_WORDS.len() as u16);
        s.call(
            "g_mem_cpy",
            CallOptions {
                registers: Some(regs),
                stack: Some(vec![CPY_DST, 0]),
                ..Default::default()
            },
        )?;
        s.expect_memory_words(CPY_DST, &CPY_WORDS)?;
        s.expect_memory_words(CPY_SRC, &CPY_WORDS)
    })
}

#[test]
fn g_mem_cpy_zero_words_keeps_destination() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.write_word(CPY_SRC, 0xcafe);
        s.write_word(CPY_DST, 0xdead);
        let mut regs = base_regs();
        regs.r0 = Some(0);
        regs.r1 = Some(CPY_SRC);
        regs.r2 = Some(0);
        s.call(
            "g_mem_cpy",
            CallOptions {
                registers: Some(regs),
                stack: Some(vec![CPY_DST, 0]),
                ..Default::default()
            },
        )?;
        assert_eq!(s.read_word(CPY_DST), 0xdead);
        Ok(())
    })
}

#[test]
fn g_mem_cpy_cross_segment_copy() -> Result<(), FrameworkError> {
    with_case(|s| {
        let dst_phys = phys_word(HEAP2_LOG, HEAP2_SBR);
        for (i, w) in CPY_WORDS.iter().enumerate() {
            s.write_word(CPY_SRC.wrapping_add(i as u16), *w);
            s.write_word_phys(dst_phys + i as u32, 0xdead);
        }
        let mut regs = base_regs();
        regs.r0 = Some(0);
        regs.r1 = Some(CPY_SRC);
        regs.r2 = Some(CPY_WORDS.len() as u16);
        s.call(
            "g_mem_cpy",
            CallOptions {
                registers: Some(regs),
                stack: Some(vec![HEAP2_LOG, HEAP2_SBR >> 2]),
                ..Default::default()
            },
        )?;
        s.expect_memory_words_phys(dst_phys, &CPY_WORDS)
    })
}

#[test]
fn g_mem_cpy_from_0x20000_to_0x38000() -> Result<(), FrameworkError> {
    with_case(|s| expect_mem_cpy_phys(s, 0x20000, 0x38000))
}

#[test]
fn g_mem_cpy_from_0x3f000_to_0x0e000() -> Result<(), FrameworkError> {
    with_case(|s| expect_mem_cpy_phys(s, 0x3f000, 0x0e000))
}

#[test]
fn g_mem_cpy_preserves_r3_r4_tsr0_tsr1() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.write_word(CPY_SRC, 0x0001);
        let mut regs = base_regs();
        regs.r0 = Some(0);
        regs.r1 = Some(CPY_SRC);
        regs.r2 = Some(1);
        regs.tsr0 = Some(0x8);
        regs.tsr1 = Some(0xc);
        s.call(
            "g_mem_cpy",
            CallOptions {
                registers: Some(regs),
                stack: Some(vec![CPY_DST, 0]),
                ..Default::default()
            },
        )?;
        s.expect_registers(
            &CallRegisters {
                r3: Some(0x3333),
                r4: Some(0x4444),
                tsr0: Some(0x8),
                tsr1: Some(0xc),
                ..Default::default()
            },
            None,
        )
    })
}

#[test]
fn g_malloc_init_writes_range_and_free_header() -> Result<(), FrameworkError> {
    with_case(|s| {
        let mut regs = base_regs();
        regs.r0 = Some(HEAP_START);
        regs.r1 = Some(16);
        s.call(
            "g_malloc_init",
            CallOptions {
                registers: Some(regs),
                ..Default::default()
            },
        )?;
        assert_eq!(s.read_word(s.word_addr("GL_ALLOC_ADR")?), HEAP_START);
        assert_eq!(s.read_word(s.word_addr("GL_ALLOC_SIZE")?), 16);
        assert_eq!(s.read_word(HEAP_START), 16);
        assert_eq!(s.read_word(HEAP_START + 1), 0);
        Ok(())
    })
}

#[test]
fn g_malloc_splits_blocks_and_returns_payload() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(HEAP_START),
                    r1: Some(16),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let a = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(4),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(a.registers.r[0], HEAP_START + HEAP_HDR);
        assert_eq!(s.read_word(HEAP_START), 4 + HEAP_HDR);
        assert_eq!(s.read_word(HEAP_START + 1), HEAP_USED);
        assert_eq!(s.read_word(HEAP_START + 6), 10);
        assert_eq!(s.read_word(HEAP_START + 7), 0);

        let b = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(8),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(b.registers.r[0], HEAP_START + 8);
        assert_eq!(s.read_word(HEAP_START + 6), 10);
        assert_eq!(s.read_word(HEAP_START + 7), HEAP_USED);
        Ok(())
    })
}

#[test]
fn g_malloc_rejects_uninitialized_zero_or_too_large() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.write_word(s.word_addr("GL_ALLOC_SIZE")?, 0);
        let uninit = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(1),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(uninit.registers.r[0], 0);

        s.call(
            "g_malloc_init",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(HEAP_START),
                    r1: Some(5),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let zero = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(0),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(zero.registers.r[0], 0);
        let big = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(4),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(big.registers.r[0], 0);
        let exact = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(3),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(exact.registers.r[0], HEAP_START + HEAP_HDR);
        Ok(())
    })
}

#[test]
fn g_free_reuses_and_merges_blocks() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(HEAP_START),
                    r1: Some(16),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let a = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let b = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(a.registers.r[0], HEAP_START + HEAP_HDR);
        assert_eq!(b.registers.r[0], HEAP_START + 8);

        let fa = s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(a.registers.r[0]),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(fa.registers.r[0], HEAP_START + HEAP_HDR);

        let reuse = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(4),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(reuse.registers.r[0], HEAP_START + HEAP_HDR);

        s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(reuse.registers.r[0]),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(b.registers.r[0]),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(s.read_word(HEAP_START), 16);
        assert_eq!(s.read_word(HEAP_START + 1), 0);

        let big = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(12),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(big.registers.r[0], HEAP_START + HEAP_HDR);
        Ok(())
    })
}

#[test]
fn g_free_rejects_zero_double_and_untracked() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(HEAP_START),
                    r1: Some(16),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;

        let z = s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(0),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(z.registers.r[0], 0);

        let bad = s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(HEAP_START + 4),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(bad.registers.r[0], 0);

        let p = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(3),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(p.registers.r[0]),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let dup = s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(p.registers.r[0]),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        assert_eq!(dup.registers.r[0], 0);
        Ok(())
    })
}

#[test]
fn g_malloc_and_g_free_preserve_r3_r4() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(HEAP_START),
                    r1: Some(8),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )?;
        let p = s.call(
            "g_malloc",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(2),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
        s.expect_registers(
            &CallRegisters {
                r3: Some(0x3333),
                r4: Some(0x4444),
                ..Default::default()
            },
            None,
        )?;
        s.call(
            "g_free",
            CallOptions {
                registers: Some(CallRegisters {
                    r0: Some(p.registers.r[0]),
                    ..base_regs()
                }),
                ..Default::default()
            },
        )?;
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
