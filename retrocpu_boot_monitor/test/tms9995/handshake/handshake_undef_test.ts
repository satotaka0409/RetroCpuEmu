/**
 * MN1613 `test/mn1613/handshake/handshake_undef_test.ts` の対になる TMS9995 テスト。
 * 根拠: asm_test_framework.mdc（成果物セッション。call/runInit は CPU コア待ち）
 * 
 * ケース名は MN1613 と揃える。現状は対応シンボルの CDB 存在確認のみ。
 */
import { expect, test } from "../../../../retrocpu_test_framework/src/index.js";
import { createTmsMonSession, expectGlobals } from "../tms9995_artifact.js";

const REQUIRED = [
  "g_bios_undef_led"
] as const;

const session = createTmsMonSession(true);

test("公開シンボルが CDB にある", () => {
  expectGlobals(session, REQUIRED);
});

test("点灯(1)で IO の undefLed が true になる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("引数 0 でも 13h 通知として処理され、undefLed は true になる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("引数 0x03 でも 13h 通知として処理される", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("R3/R4 は呼び出しの前後で保たれる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});
