// Ported from test/tms9995/tms9995_mon_settings.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_module_tms9995_mon_settings_symbols_resolve() {
    super::assert_tms9995_symbols_have_code("test/tms9995/tms9995_mon_settings.ts", SYMBOLS);
}
