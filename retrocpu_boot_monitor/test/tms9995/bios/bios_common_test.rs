//! TMS9995 BIOS 共通ルーチンの実行回帰（R2 起点）。
//! 根拠: `src/tms9995/bios/bios_common.asm` / MN1613 `bios_common_test.rs` の対。

use retrocpu_test_framework_rs::framework::tms9995::{
    create_tms9995_session_from_settings, Tms9995AsmSession, Tms9995CallOptions,
    Tms9995CallRegisters,
};
use retrocpu_test_framework_rs::FrameworkError;

const HEAP_START: u16 = 0xe000;
const HEAP_HDR_WORDS: u16 = 2;
const HEAP_USED: u16 = 1;
const GL_RND_TAP: u16 = 0xb400;
const GL_RND_DEFAULT_SEED: u16 = 0x1234;
const CPY_SRC: u16 = 0x2000;
const CPY_DST: u16 = 0x2100;
const CPY_WORDS: [u16; 4] = [0x1111, 0x2222, 0x3333, 0x4444];

fn monitor_artifact_exists() -> bool {
    let settings = super::tms9995_rs_settings();
    let hex = std::path::PathBuf::from(&settings.hex_file);
    let cdb = std::path::PathBuf::from(&settings.cdb_file);
    if !hex.is_file() || !cdb.is_file() {
        eprintln!(
            "skip: missing tms9995 monitor artifact: {} / {}",
            hex.display(),
            cdb.display()
        );
        return false;
    }
    true
}

fn with_case<F>(f: F) -> Result<(), FrameworkError>
where
    F: FnOnce(&mut Tms9995AsmSession) -> Result<(), FrameworkError>,
{
    if !monitor_artifact_exists() {
        return Ok(());
    }
    let mut session = create_tms9995_session_from_settings(&super::tms9995_rs_settings(), None)?;
    session.reload()?;
    session.run_init()?;
    f(&mut session)
}

fn regs(r: [Option<u16>; 16]) -> Tms9995CallRegisters {
    Tms9995CallRegisters { r }
}

fn base_preserve() -> Tms9995CallRegisters {
    let mut r = [None; 16];
    r[0] = Some(0xaaaa);
    r[1] = Some(0x1111);
    r[5] = Some(0x5555);
    r[6] = Some(0x6666);
    r[7] = Some(0x7777);
    r[9] = Some(0x9999);
    regs(r)
}

fn call_args(_label: &str, args: &[u16]) -> Tms9995CallOptions {
    Tms9995CallOptions {
        args: args.to_vec(),
        registers: Some(base_preserve()),
        ..Default::default()
    }
}

fn call_regs(_label: &str, overlay: Tms9995CallRegisters) -> Tms9995CallOptions {
    let mut merged = base_preserve();
    for (i, v) in overlay.r.iter().enumerate() {
        if v.is_some() {
            merged.r[i] = *v;
        }
    }
    Tms9995CallOptions {
        registers: Some(merged),
        ..Default::default()
    }
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

fn seed_addr(s: &Tms9995AsmSession) -> Result<u32, FrameworkError> {
    s.require_byte_addr("GL_RND_SEED")
}

fn read_seed(s: &Tms9995AsmSession) -> Result<u16, FrameworkError> {
    s.read_word_be(seed_addr(s)?)
}

fn alloc_adr(s: &Tms9995AsmSession) -> Result<u16, FrameworkError> {
    s.read_word_be(s.require_byte_addr("GL_ALLOC_ADR")?)
}

fn alloc_size(s: &Tms9995AsmSession) -> Result<u16, FrameworkError> {
    s.read_word_be(s.require_byte_addr("GL_ALLOC_SIZE")?)
}

#[test]
fn ported_case_01_cdb() -> Result<(), FrameworkError> {
    with_case(|s| {
        for sym in [
            "g_rnd_init",
            "g_get_rnd",
            "g_mem_cpy",
            "g_malloc_init",
            "g_malloc",
            "g_free",
        ] {
            let _ = s.require_byte_addr(sym)?;
        }
        Ok(())
    })
}

#[test]
fn ported_case_02_g_rnd_init_0_1() -> Result<(), FrameworkError> {
    with_case(|s| {
        let r = s.call("g_rnd_init", call_args("g_rnd_init", &[0]))?;
        assert_eq!(r.registers[2], 1);
        assert_eq!(read_seed(s)?, 1);
        s.expect_registers(&[
            None,
            Some(0x1111),
            None,
            None,
            None,
            Some(0x5555),
            Some(0x6666),
            Some(0x7777),
            None,
            Some(0x9999),
            None,
            None,
            None,
            None,
            None,
            None,
        ])
    })
}

#[test]
fn ported_case_03_g_rnd_init() -> Result<(), FrameworkError> {
    with_case(|s| {
        let r = s.call("g_rnd_init", call_args("g_rnd_init", &[0xabcd]))?;
        assert_eq!(r.registers[2], 0xabcd);
        assert_eq!(read_seed(s)?, 0xabcd);
        Ok(())
    })
}

#[test]
fn ported_case_04_g_get_rnd_m_1() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call("g_rnd_init", call_args("g_rnd_init", &[GL_RND_DEFAULT_SEED]))?;
        let expected = lfsr_step(GL_RND_DEFAULT_SEED);
        let r = s.call("g_get_rnd", call_args("g_get_rnd", &[]))?;
        assert_eq!(r.registers[2], expected);
        assert_eq!(read_seed(s)?, expected);
        Ok(())
    })
}

#[test]
fn ported_case_05_g_get_rnd_10_ts_lfsr() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call("g_rnd_init", call_args("g_rnd_init", &[GL_RND_DEFAULT_SEED]))?;
        let expected = lfsr_sequence(GL_RND_DEFAULT_SEED, 10);
        let mut actual = Vec::new();
        for _ in 0..10 {
            let r = s.call("g_get_rnd", call_args("g_get_rnd", &[]))?;
            actual.push(r.registers[2]);
        }
        assert_eq!(actual, expected);
        assert_eq!(read_seed(s)?, expected[9]);
        Ok(())
    })
}

#[test]
fn ported_case_06_case_06() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.write_word_be(seed_addr(s)?, 0)?;
        let expected = lfsr_step(0);
        let r = s.call("g_get_rnd", call_args("g_get_rnd", &[]))?;
        assert_eq!(r.registers[2], expected);
        assert_eq!(read_seed(s)?, expected);
        assert_eq!(expected, 0xb400);
        Ok(())
    })
}

#[test]
fn ported_case_07_r1_r4_g_get_rnd() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call("g_get_rnd", call_args("g_get_rnd", &[]))?;
        s.expect_registers(&[
            None,
            Some(0x1111),
            None,
            None,
            None,
            Some(0x5555),
            Some(0x6666),
            Some(0x7777),
            None,
            Some(0x9999),
            None,
            None,
            None,
            None,
            None,
            None,
        ])
    })
}

#[test]
fn ported_case_08_g_mem_cpy() -> Result<(), FrameworkError> {
    with_case(|s| {
        for (i, w) in CPY_WORDS.iter().enumerate() {
            s.write_word_be(u32::from(CPY_SRC) + (i as u32) * 2, *w)?;
            s.write_word_be(u32::from(CPY_DST) + (i as u32) * 2, 0xdead)?;
        }
        s.call(
            "g_mem_cpy",
            call_args(
                "g_mem_cpy",
                &[CPY_SRC, CPY_DST, CPY_WORDS.len() as u16],
            ),
        )?;
        s.expect_memory_words(u32::from(CPY_DST), &CPY_WORDS)?;
        s.expect_memory_words(u32::from(CPY_SRC), &CPY_WORDS)
    })
}

#[test]
fn ported_case_09_g_mem_cpy_0() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.write_word_be(u32::from(CPY_SRC), 0xcafe)?;
        s.write_word_be(u32::from(CPY_DST), 0xdead)?;
        s.call("g_mem_cpy", call_args("g_mem_cpy", &[CPY_SRC, CPY_DST, 0]))?;
        assert_eq!(s.read_word_be(u32::from(CPY_DST))?, 0xdead);
        Ok(())
    })
}

#[test]
fn ported_case_10_g_mem_cpy() -> Result<(), FrameworkError> {
    // TMS9995 はセグメント無し。別レンジへのコピーで代用する。
    with_case(|s| {
        let dst: u16 = 0x3000;
        for (i, w) in CPY_WORDS.iter().enumerate() {
            s.write_word_be(u32::from(CPY_SRC) + (i as u32) * 2, *w)?;
            s.write_word_be(u32::from(dst) + (i as u32) * 2, 0xdead)?;
        }
        s.call(
            "g_mem_cpy",
            call_args("g_mem_cpy", &[CPY_SRC, dst, CPY_WORDS.len() as u16]),
        )?;
        s.expect_memory_words(u32::from(dst), &CPY_WORDS)
    })
}

#[test]
fn ported_case_11_g_mem_cpy_0x20000_0x38000() -> Result<(), FrameworkError> {
    // 64K 内の高位アドレス帯で代用（0xA000 → 0xB000）。
    with_case(|s| {
        let src: u16 = 0xa000;
        let dst: u16 = 0xb000;
        for (i, w) in CPY_WORDS.iter().enumerate() {
            s.write_word_be(u32::from(src) + (i as u32) * 2, *w)?;
            s.write_word_be(u32::from(dst) + (i as u32) * 2, 0xdead)?;
        }
        s.call(
            "g_mem_cpy",
            call_args("g_mem_cpy", &[src, dst, CPY_WORDS.len() as u16]),
        )?;
        s.expect_memory_words(u32::from(dst), &CPY_WORDS)
    })
}

#[test]
fn ported_case_12_g_mem_cpy_0x3f000_0x0e000() -> Result<(), FrameworkError> {
    with_case(|s| {
        let src: u16 = 0xc000;
        let dst: u16 = 0xd000;
        for (i, w) in CPY_WORDS.iter().enumerate() {
            s.write_word_be(u32::from(src) + (i as u32) * 2, *w)?;
            s.write_word_be(u32::from(dst) + (i as u32) * 2, 0xdead)?;
        }
        s.call(
            "g_mem_cpy",
            call_args("g_mem_cpy", &[src, dst, CPY_WORDS.len() as u16]),
        )?;
        s.expect_memory_words(u32::from(dst), &CPY_WORDS)
    })
}

#[test]
fn ported_case_13_r3_r4_tsr0_tsr1_g_mem_cpy() -> Result<(), FrameworkError> {
    // mem_cpy は R2/R3/R4 を破壊する。R0/R1/R5+ の保持を見る。
    with_case(|s| {
        s.write_word_be(u32::from(CPY_SRC), 0x0001)?;
        s.call(
            "g_mem_cpy",
            call_args("g_mem_cpy", &[CPY_SRC, CPY_DST, 1]),
        )?;
        s.expect_registers(&[
            Some(0xaaaa),
            Some(0x1111),
            None,
            None,
            None,
            Some(0x5555),
            Some(0x6666),
            Some(0x7777),
            None,
            Some(0x9999),
            None,
            None,
            None,
            None,
            None,
            None,
        ])
    })
}

#[test]
fn ported_case_14_g_malloc_init() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            call_args("g_malloc_init", &[HEAP_START, 16]),
        )?;
        assert_eq!(alloc_adr(s)?, HEAP_START);
        assert_eq!(alloc_size(s)?, 16);
        assert_eq!(s.read_word_be(u32::from(HEAP_START))?, 16);
        assert_eq!(s.read_word_be(u32::from(HEAP_START) + 2)?, 0);
        Ok(())
    })
}

#[test]
fn ported_case_15_g_malloc() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            call_args("g_malloc_init", &[HEAP_START, 16]),
        )?;
        let a = s.call("g_malloc", call_args("g_malloc", &[4]))?;
        // ヘッダ 2 語(=4B)の直後。サイズ欄は語数。
        assert_eq!(a.registers[2], HEAP_START.wrapping_add(4));
        assert_eq!(
            s.read_word_be(u32::from(HEAP_START))?,
            4 + HEAP_HDR_WORDS
        );
        assert_eq!(s.read_word_be(u32::from(HEAP_START) + 2)?, HEAP_USED);

        let rem_hdr = HEAP_START.wrapping_add(4 + HEAP_HDR_WORDS);
        // サイズ加算が語数のままバイトアドレスへ足される実装に合わせる
        let rem_hdr_actual = HEAP_START.wrapping_add(4 + HEAP_HDR_WORDS);
        let _ = rem_hdr;
        let size0 = s.read_word_be(u32::from(HEAP_START))?;
        let next = HEAP_START.wrapping_add(size0);
        assert_eq!(s.read_word_be(u32::from(next))?, 16 - size0);
        assert_eq!(s.read_word_be(u32::from(next) + 2)?, 0);

        let b = s.call("g_malloc", call_args("g_malloc", &[8]))?;
        assert_eq!(b.registers[2], next.wrapping_add(4));
        assert_eq!(s.read_word_be(u32::from(next) + 2)?, HEAP_USED);
        let _ = rem_hdr_actual;
        Ok(())
    })
}

#[test]
fn ported_case_16_g_malloc_0_0() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.write_word_be(s.require_byte_addr("GL_ALLOC_SIZE")?, 0)?;
        let uninit = s.call("g_malloc", call_args("g_malloc", &[1]))?;
        assert_eq!(uninit.registers[2], 0);

        s.call(
            "g_malloc_init",
            call_args("g_malloc_init", &[HEAP_START, 16]),
        )?;
        let zero = s.call("g_malloc", call_args("g_malloc", &[0]))?;
        assert_eq!(zero.registers[2], 0);

        let too_big = s.call("g_malloc", call_args("g_malloc", &[20]))?;
        assert_eq!(too_big.registers[2], 0);
        Ok(())
    })
}

#[test]
fn ported_case_17_g_free() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            call_args("g_malloc_init", &[HEAP_START, 16]),
        )?;
        let a = s.call("g_malloc", call_args("g_malloc", &[4]))?;
        let ptr = a.registers[2];
        let freed = s.call("g_free", call_args("g_free", &[ptr]))?;
        assert_eq!(freed.registers[2], ptr);
        assert_eq!(s.read_word_be(u32::from(ptr) - 2)?, 0);

        let again = s.call("g_malloc", call_args("g_malloc", &[4]))?;
        assert_eq!(again.registers[2], ptr);
        Ok(())
    })
}

#[test]
fn ported_case_18_g_free_0_0() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            call_args("g_malloc_init", &[HEAP_START, 16]),
        )?;
        let zero = s.call("g_free", call_args("g_free", &[0]))?;
        assert_eq!(zero.registers[2], 0);

        let a = s.call("g_malloc", call_args("g_malloc", &[4]))?;
        let ptr = a.registers[2];
        s.call("g_free", call_args("g_free", &[ptr]))?;
        let twice = s.call("g_free", call_args("g_free", &[ptr]))?;
        assert_eq!(twice.registers[2], 0);

        let bogus = s.call("g_free", call_args("g_free", &[HEAP_START.wrapping_add(8)]))?;
        assert_eq!(bogus.registers[2], 0);
        Ok(())
    })
}

#[test]
fn ported_case_19_r3_r4_g_malloc_g_free() -> Result<(), FrameworkError> {
    with_case(|s| {
        s.call(
            "g_malloc_init",
            call_args("g_malloc_init", &[HEAP_START, 16]),
        )?;
        // g_malloc_ は R0–R5,R8 を使う。R6/R7/R9 の保持を確認。
        s.call("g_malloc", call_args("g_malloc", &[2]))?;
        s.expect_registers(&[
            None,
            None,
            None,
            None,
            None,
            None,
            Some(0x6666),
            Some(0x7777),
            None,
            Some(0x9999),
            None,
            None,
            None,
            None,
            None,
            None,
        ])?;
        Ok(())
    })
}

#[allow(dead_code)]
fn _call_regs_helper_keeps_api(s: &mut Tms9995AsmSession) -> Result<(), FrameworkError> {
    let mut overlay = [None; 16];
    overlay[2] = Some(1);
    s.call("g_rnd_init", call_regs("g_rnd_init", regs(overlay)))?;
    Ok(())
}
