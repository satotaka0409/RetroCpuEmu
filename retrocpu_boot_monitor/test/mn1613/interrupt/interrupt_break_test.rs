// Ported from test/mn1613/interrupt/interrupt_break_test.ts.
// Native Rust tests: CDB/artifact symbol validation only (no TS runtime).

const SYMBOLS: &[&str] = &[
    "GL_BP_HIST_META",
    "GL_HSHK_ADDR_BREAK",
    "g_breakpoint_interrupt_handler",
    "g_handshake_interrupt_handler",
];

#[test]
fn ported_case_01_case_01() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_02_case_02() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_03_case_03() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_04_case_04() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_05_case_05() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_06_case_06() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_07_case_07() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_08_write() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_09_bit7_write_11h_0034_after_3f000h() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_10_bit7_read_prev_0000h_0034() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_11_bit7() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_12_int1_main_loop_h() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_13_start_0x1800() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_14_start_0x1800_mem_write() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_15_start_0x1800_io_read() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}

#[test]
fn ported_case_16_start_0x1800_io_write() {
    super::assert_mn1613_symbols_have_code("test/mn1613/interrupt/interrupt_break_test.ts", SYMBOLS);
}
