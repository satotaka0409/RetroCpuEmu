/**
 * MN1613 `test/mn1613/breakpoint/breakpoint_hist_test.ts` の対になる TMS9995 テスト。
 * 根拠: asm_test_framework.mdc（成果物セッション。call/runInit は CPU コア待ち）
 * 
 * ケース名は MN1613 と揃える。現状は対応シンボルの CDB 存在確認のみ。
 */
import { expect, test } from "../../../../retrocpu_test_framework_ts/src/index.js";
import { createTmsMonSession, expectGlobals } from "../tms9995_artifact.js";

const REQUIRED = [
  "g_bp_hist_append"
] as const;

const session = createTmsMonSession(true);

test("公開シンボルが CDB にある", () => {
  expectGlobals(session, REQUIRED);
});

test("WRITE は 11h 時刻と AFTER/PREV をスロット 0 の 3F000h に書く", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("スロット 3 は slot×132 先へ書く", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("READ / 命令の PREV は 0000h", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("IO 区分の AFTER は 0", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("5 件目は件数 4 のままオーバフローを立て、index 0 を上書きする", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("R2/R3/R4 は追記の前後で保たれる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});
