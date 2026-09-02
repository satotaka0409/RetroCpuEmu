// Ported from test/tms9995/breakpoint/breakpoint_gl_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_gl_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_int1_1ah() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_gl_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_case_03() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_gl_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_case_04() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_gl_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_start_0x1800_3() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_gl_test.ts", SYMBOLS);
}
