/**
 * MN1613 `test/mn1613/handshake/handshake_lcd2_test.ts` の対になる TMS9995 テスト。
 * 根拠: asm_test_framework.mdc（成果物セッション。call/runInit は CPU コア待ち）
 * 
 * ケース名は MN1613 と揃える。現状は対応シンボルの CDB 存在確認のみ。
 */
import { expect, test } from "../../../../retrocpu_test_framework_ts/src/index.js";
import { createTmsMonSession, expectGlobals } from "../tms9995_artifact.js";

const REQUIRED = [
  "g_bios_lcd_text"
] as const;

const session = createTmsMonSession(true);

test("公開シンボルが CDB にある", () => {
  expectGlobals(session, REQUIRED);
});

test("18h フレームを20バイトで送り、len以降は空白で埋める", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("len が 16 を超えると先頭16文字だけ送る", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});

test("R3/R4 は呼び出しの前後で保たれる", () => {
  // 実行回帰は TMS9995 CPU エミュ実装後に MN1613 と同内容へ置き換える
  expectGlobals(session, REQUIRED);
  expect(() => session.call(REQUIRED[0]!)).toThrow(/CPU emu/);
});
