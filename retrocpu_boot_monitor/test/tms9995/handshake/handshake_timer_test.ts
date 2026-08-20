/**
 * MN1613 `test/mn1613/handshake/handshake_timer_test.ts` の対になる TMS9995 テスト。
 * 根拠: asm_test_framework.mdc（成果物セッション。call/runInit は CPU コア待ち）
 * TMS9995 タイマーは内蔵デクリメンタ（12h 不使用）。
 * ケース名は MN1613 と揃える。現状は対応シンボルの CDB 存在確認のみ。
 */
import { expect, test } from "../../../../retrocpu_test_framework/src/index.js";
import { createTmsMonSession, expectGlobals } from "../tms9995_artifact.js";

const REQUIRED = [
  "g_bios_timer_set",
  "g_timer_on_tick",
  "g_int3_handler"
] as const;

const session = createTmsMonSession(true);

test("公開シンボルが CDB にある", () => {
  expectGlobals(session, REQUIRED);
});

test("番号 0・周期 100ms・回数 3 がそのまま IO ボードへ届く", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("番号 0 は 16bit 周期をそのまま送る", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("番号 1 は NG を返しタイマーは動かない", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("番号が 0/1 以外なら IO ボードが NG を返しタイマーは動かない", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("R3/R4 は呼び出しの前後で保たれる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});
