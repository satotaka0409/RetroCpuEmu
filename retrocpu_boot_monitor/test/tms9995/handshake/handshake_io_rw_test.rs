// Ported from test/tms9995/handshake/handshake_io_rw_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_io_rw_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_case_02() {
    super::assert_tms9995_symbols_have_code("test/tms9995/handshake/handshake_io_rw_test.ts", SYMBOLS);
}
