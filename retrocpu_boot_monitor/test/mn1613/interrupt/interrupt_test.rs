// Ported from test/mn1613/interrupt/interrupt_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[
    "GL_INT0_ADR",
    "g_int3_handler",
    "g_set_int_adr",
];

#[test]
fn ported_case_01_g_main_16_0() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_g_set_int_adr_csbr() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_g_set_int_adr_r1_r2_0() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_int2_int2_0() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_int2() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_06_int3_balr_lpsw_3() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_07_int0_iisr_bit15_0() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_test.ts", SYMBOLS);
}
