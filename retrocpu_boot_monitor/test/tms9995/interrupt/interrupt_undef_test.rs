// Ported from test/tms9995/interrupt/interrupt_undef_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_undef_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_int0_iisr_bit15() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_undef_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_gl_undef_inst_reg() {
    super::assert_tms9995_symbols_have_code("test/tms9995/interrupt/interrupt_undef_test.ts", SYMBOLS);
}
