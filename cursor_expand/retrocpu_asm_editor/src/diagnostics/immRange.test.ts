import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mn1613Architecture } from "../cpu/mn1613/arch";
import { parseAsmLine } from "../symbols/parseLine";
import { findImmRangeOverflows } from "./immRange";

describe("findImmRangeOverflows", () => {
  const arch = mn1613Architecture;

  /**
   * @param line ソース行
   * @returns 診断メッセージ一覧
   */
  function msgs(line: string): string[] {
    const parsed = parseAsmLine(line, arch);
    return findImmRangeOverflows(line, parsed, arch).map((h) => h.message);
  }

  test("MVI #255 は問題なし", () => {
    assert.deepEqual(msgs("\tmvi\tR0, #255"), []);
  });

  test("MVI #256 は 8bit 範囲外", () => {
    assert.match(msgs("\tmvi\tR0, #256")[0] ?? "", /8bit/);
  });

  test("MVI #0x00000111 は 8bit 範囲外", () => {
    assert.match(msgs("\tmvi\tR0, #0x00000111")[0] ?? "", /8bit/);
  });

  test("MVWI #0xFFFF / #-1 は問題なし", () => {
    assert.deepEqual(msgs("\tmvwi\tR0, #0xFFFF"), []);
    assert.deepEqual(msgs("\tmvwi\tSP, #-1"), []);
  });

  test("MVWI #65536 は 16bit 範囲外", () => {
    assert.match(msgs("\tmvwi\tR0, #65536")[0] ?? "", /16bit/);
  });

  test("MVWI #0x0000011100000000 は 16bit 範囲外", () => {
    assert.match(
      msgs("\tmvwi\tR0, #0x0000011100000000")[0] ?? "",
      /16bit/,
    );
  });

  test(".dw ラベルは数値評価できないのでスキップ", () => {
    assert.deepEqual(msgs("\t.dw\tg_main"), []);
  });

  test(".dw 0x0000011100000000 は 16bit 範囲外", () => {
    assert.match(msgs("\t.dw\t0x0000011100000000")[0] ?? "", /16bit/);
  });

  test(".dw -1 は問題なし", () => {
    assert.deepEqual(msgs("\t.dw\t-1"), []);
  });
});
