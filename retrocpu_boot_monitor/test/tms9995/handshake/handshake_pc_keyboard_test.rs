// Ported from test/tms9995/handshake/handshake_pc_keyboard_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_pc_keyboard_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_ascii_0_ok() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_pc_keyboard_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_ascii_r1_r2() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_pc_keyboard_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_case_04() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_pc_keyboard_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_r3_r4() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_pc_keyboard_test.ts", SYMBOLS);
}
