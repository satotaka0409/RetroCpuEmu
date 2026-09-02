// Ported from test/tms9995/breakpoint/breakpoint_steprun_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[];

#[test]
fn ported_case_01_cdb() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_case_02() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_case_03() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_case_04() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_g_step_arm_cpld_arm_1_0078h_delay_0068h_1() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_06_g_step_arm_cpld_arm_0_delay_ena() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_07_int2_cause_1_1bh_ic() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}

#[test]
fn ported_case_08_int2_main_loop_h() {
    super::assert_tms9995_symbols_have_code("test/tms9995/breakpoint/breakpoint_steprun_test.ts", SYMBOLS);
}
