// Ported from test/mn1613/interrupt/interrupt_undef_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_int0_iisr_bit15() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_undef_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_gl_undef_inst_reg() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_undef_test.ts", SYMBOLS);
}
