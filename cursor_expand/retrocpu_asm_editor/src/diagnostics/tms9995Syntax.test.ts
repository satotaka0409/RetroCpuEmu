/**
 * TMS9995 構文診断のテスト。
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tms9995Architecture } from "../cpu/tms9995/arch";
import { TMS9995_INSN_HELP } from "../cpu/tms9995/insnHelp";
import { parseAsmLine } from "../symbols/parseLine";
import { findTms9995SyntaxIssues } from "./tms9995Syntax";

/**
 * 1 行の診断メッセージ一覧。
 * @param src ソース行
 * @returns メッセージ
 */
function msgs(src: string): string[] {
  const parsed = parseAsmLine(src, tms9995Architecture);
  return findTms9995SyntaxIssues(src, parsed, tms9995Architecture).map(
    (h) => h.message,
  );
}

describe("findTms9995SyntaxIssues", () => {
  test("正しい sdas 行は診断しない", () => {
    assert.deepEqual(msgs("        LI R1, #0x1234"), []);
    assert.deepEqual(msgs("        MOV R1, R2"), []);
    assert.deepEqual(msgs("        MOV (R3)+, R0"), []);
    assert.deepEqual(msgs("        B START"), []);
    assert.deepEqual(msgs("        B (R11)"), []);
    assert.deepEqual(msgs("        SBO #0"), []);
    assert.deepEqual(msgs("        STCR R1, #16"), []);
    assert.deepEqual(msgs("        XOP R1, #3"), []);
    assert.deepEqual(msgs("        SRA R1, #0"), []);
    assert.deepEqual(msgs("        RT"), []);
    assert.deepEqual(msgs("        NOP"), []);
  });

  test("即値に # が無い", () => {
    const m = msgs("        LI R1, 0x1234");
    assert.ok(m.some((x) => /'#'/.test(x)));
  });

  test("TI 風 @ / *R を拒否", () => {
    assert.ok(msgs("        B @START").some((x) => /TI/.test(x)));
    assert.ok(msgs("        B *R11").some((x) => /TI/.test(x)));
  });

  test("インデックスに R0 は使えない", () => {
    assert.ok(msgs("        MOV TAB(R0), R1").some((x) => /R0/.test(x)));
  });

  test("汎用アドレスに # は使えない", () => {
    assert.ok(msgs("        MOV R1, #2").some((x) => /即値/.test(x)));
  });

  test("CRU 変位の範囲", () => {
    assert.deepEqual(msgs("        TB #-1"), []);
    assert.ok(msgs("        SBO #-129").some((x) => /範囲外/.test(x)));
  });

  test("シフト回数と XOP 番号の範囲", () => {
    assert.ok(msgs("        SLA R1, #16").some((x) => /範囲外/.test(x)));
    assert.ok(msgs("        XOP R1, #16").some((x) => /範囲外/.test(x)));
  });

  test("オペランド数", () => {
    assert.ok(msgs("        CLR").some((x) => /オペランド数/.test(x)));
    assert.ok(msgs("        RT R1").some((x) => /オペランド数/.test(x)));
  });

  test("ホバー説明が全ニーモニックにある", () => {
    for (const m of tms9995Architecture.mnemonics) {
      assert.ok(TMS9995_INSN_HELP[m], `missing help: ${m}`);
    }
  });
});
