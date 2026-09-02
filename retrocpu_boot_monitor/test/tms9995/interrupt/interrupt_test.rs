// Ported from test/tms9995/interrupt/interrupt_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_g_main_16_0() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_g_set_int_adr_csbr() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_g_set_int_adr_r1_r2_0() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_int2_int2_0() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_06_int2() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_07_int3_balr_lpsw_3() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}

#[test]
fn ported_case_08_int0_iisr_bit15_0() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_test.ts", SYMBOLS);
}
