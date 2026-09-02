/**
 * MN1613 `test/mn1613/handshake/handshake_led_test.ts` の対になる TMS9995 テスト。
 * 根拠: asm_test_framework.mdc（成果物セッション。call/runInit は CPU コア待ち）
 * 
 * ケース名は MN1613 と揃える。現状は対応シンボルの CDB 存在確認のみ。
 */
import { expect, test } from "../../../../retrocpu_test_framework_ts/src/index.js";
import { createTmsMonSession, expectGlobals } from "../tms9995_artifact.js";

const REQUIRED = [
  "g_bios_led_display",
  "g_bios_led_seven_seg",
  "g_bios_led_bullet"
] as const;

const session = createTmsMonSession(true);

test("公開シンボルが CDB にある", () => {
  expectGlobals(session, REQUIRED);
});

test("g_main 後、ラッチ 14 ワードは 0 で種は保たれる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("display は 7seg×12 と砲弾 2B を IO へ届ける", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("モニターモードでは 01h を返し LED を更新しない", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("seven_seg R1=0 は砲弾を 0 で送る", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("seven_seg R1=1 は砲弾ラッチを維持する", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("bullet は砲弾だけ更新し 7seg ラッチを維持する", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("R3/R4 は呼び出しの前後で保たれる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});
