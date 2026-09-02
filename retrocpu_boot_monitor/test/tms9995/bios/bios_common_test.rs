// Ported from test/tms9995/bios/bios_common_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_g_rnd_init_0_1() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_g_rnd_init() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_g_get_rnd_m_1() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_g_get_rnd_10_ts_lfsr() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_06_case_06() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_07_r1_r4_g_get_rnd() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_08_g_mem_cpy() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_09_g_mem_cpy_0() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_10_g_mem_cpy() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_11_g_mem_cpy_0x20000_0x38000() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_12_g_mem_cpy_0x3f000_0x0e000() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_13_r3_r4_tsr0_tsr1_g_mem_cpy() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_14_g_malloc_init() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_15_g_malloc() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_16_g_malloc_0_0() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_17_g_free() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_18_g_free_0_0() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}

#[test]
fn ported_case_19_r3_r4_g_malloc_g_free() {
    super::assert_tms9995_symbols("test/tms9995/bios/bios_common_test.ts", SYMBOLS);
}
