import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mn1613Architecture } from "../cpu/mn1613/arch";
import { parseAsmLine } from "../symbols/parseLine";
import {
  findInvalidCopySetOperands,
  findInvalidEaIndexOperands,
  findInvalidGprOperands,
} from "./invalidRegisters";

describe("findInvalidGprOperands", () => {
  const arch = mn1613Architecture;

  /**
   * @param line ソース行
   * @returns 不正レジスタ名一覧
   */
  function names(line: string): string[] {
    const parsed = parseAsmLine(line, arch);
    return findInvalidGprOperands(line, parsed, arch).map((h) => h.name);
  }

  test("mv R0, OSR0 は OSR0 を不正とする", () => {
    assert.deepEqual(names("\tmv\tR0, OSR0"), ["OSR0"]);
  });

  test("mv R0, CSBR は CSBR を不正とする", () => {
    assert.deepEqual(names("\tmv\tR0, CSBR"), ["CSBR"]);
  });

  test("mv R0, R1 は問題なし", () => {
    assert.deepEqual(names("\tmv\tR0, R1"), []);
  });

  test("cpyb R0, OSR0 は許可（GPR 専用ではない）", () => {
    assert.deepEqual(names("\tcpyb\tR0, OSR0"), []);
  });

  test("cpys R0, NPP は許可", () => {
    assert.deepEqual(names("\tcpys\tR0, NPP"), []);
  });

  test("andi R0, #1 は問題なし", () => {
    assert.deepEqual(names("\tandi\tR0, #1"), []);
  });

  test("メッセージに代替命令のヒントが含まれる", () => {
    const line = "\tmv\tR0, OSR0";
    const parsed = parseAsmLine(line, arch);
    const hits = findInvalidGprOperands(line, parsed, arch);
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /CPYB/);
  });
});

describe("findInvalidEaIndexOperands", () => {
  const arch = mn1613Architecture;

  /**
   * @param line ソース行
   * @returns 不正インデックス名一覧
   */
  function names(line: string): string[] {
    const parsed = parseAsmLine(line, arch);
    return findInvalidEaIndexOperands(line, parsed, arch).map((h) => h.name);
  }

  test("st R0, (*GL_INT0_ADR)(R2) は R2 を不正とする", () => {
    assert.deepEqual(names("\tst\tR0, (*GL_INT0_ADR)(R2)"), ["R2"]);
  });

  test("st R0, (*5)(X0) は問題なし", () => {
    assert.deepEqual(names("\tst\tR0, (*5)(X0)"), []);
  });

  test("L R0, (*5)(X1) は問題なし", () => {
    assert.deepEqual(names("\tL\tR0, (*5)(X1)"), []);
  });

  test("st R0, (*5)(R3) は R3 を不正とする（X0 と書く）", () => {
    assert.deepEqual(names("\tst\tR0, (*5)(R3)"), ["R3"]);
  });

  test("L R0, 0(R2) は R2 を不正とする", () => {
    assert.deepEqual(names("\tL\tR0, 0(R2)"), ["R2"]);
  });

  test("l R0,4(SP) は SP 相対が無いので不正", () => {
    assert.deepEqual(names("\tl\tR0,4(SP)"), ["SP"]);
  });

  test("L R0, 4(SP) は SP を不正とする", () => {
    assert.deepEqual(names("\tL\tR0, 4(SP)"), ["SP"]);
  });

  test("L R0, (SP) はレジスタ間接が無いので不正", () => {
    assert.deepEqual(names("\tL\tR0, (SP)"), ["SP"]);
  });

  test("L R0, 4(X0) は問題なし", () => {
    assert.deepEqual(names("\tL\tR0, 4(X0)"), []);
  });

  test("ST R0, 1(X1) は問題なし", () => {
    assert.deepEqual(names("\tST\tR0, 1(X1)"), []);
  });

  test("LD R0, 0x0300(TSR0) は 16bit+ベースなので対象外", () => {
    assert.deepEqual(names("\tLD\tR0, 0x0300(TSR0)"), []);
  });

  test("LR R0, (R2) はレジスタ間接なので対象外", () => {
    assert.deepEqual(names("\tLR\tR0, (R2)"), []);
  });

  test("L R0, [*5], R2 は R2 を不正とする", () => {
    assert.deepEqual(names("\tL\tR0, [*5], R2"), ["R2"]);
  });

  test("4(SP) のメッセージは SP 相対が無いと書く", () => {
    const line = "\tl\tR0,4(SP)";
    const parsed = parseAsmLine(line, arch);
    const hits = findInvalidEaIndexOperands(line, parsed, arch);
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /SP 相対/);
  });

  test("メッセージに X0/X1 のヒントが含まれる", () => {
    const line = "\tst\tR0, (*GL_INT0_ADR)(R2)";
    const parsed = parseAsmLine(line, arch);
    const hits = findInvalidEaIndexOperands(line, parsed, arch);
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.message, /X0 \/ X1/);
  });
});

describe("findInvalidCopySetOperands", () => {
  const arch = mn1613Architecture;

  /**
   * @param line ソース行
   * @returns ヒットしたレジスタ／命令名
   */
  function names(line: string): string[] {
    const parsed = parseAsmLine(line, arch);
    return findInvalidCopySetOperands(line, parsed, arch).map((h) => h.name);
  }

  /**
   * @param line ソース行
   * @returns 先頭ヒットのメッセージ。無ければ ""
   */
  function msg(line: string): string {
    const parsed = parseAsmLine(line, arch);
    return findInvalidCopySetOperands(line, parsed, arch)[0]?.message ?? "";
  }

  test("cpyb R0, TSR1 は許可", () => {
    assert.deepEqual(names("\tcpyb\tR0, TSR1"), []);
  });

  test("cpyb R1, OSR0 は許可", () => {
    assert.deepEqual(names("\tcpyb\tR1, OSR0"), []);
  });

  test("setb R1, TSR1 は許可", () => {
    assert.deepEqual(names("\tsetb\tR1, TSR1"), []);
  });

  test("cpys R0, NPP は許可", () => {
    assert.deepEqual(names("\tcpys\tR0, NPP"), []);
  });

  test("cpyh R0, IISR は許可", () => {
    assert.deepEqual(names("\tcpyh\tR0, IISR"), []);
  });

  test("cpyh R0, TSR は許可（タイマ TSR。TSR0 とは別）", () => {
    assert.deepEqual(names("\tcpyh\tR0, TSR"), []);
  });

  test("cpyb TSR1, R1 は語順エラー（SETB を案内）", () => {
    assert.deepEqual(names("\tcpyb\tTSR1, R1"), ["TSR1"]);
    assert.match(msg("\tcpyb\tTSR1, R1"), /SETB R1, TSR1/);
  });

  test("setb TSR1, R1 は語順エラー", () => {
    assert.deepEqual(names("\tsetb\tTSR1, R1"), ["TSR1"]);
    assert.match(msg("\tsetb\tTSR1, R1"), /SETB は R1, TSR1/);
  });

  test("cpyb R0, NPP は CPYS を案内", () => {
    assert.deepEqual(names("\tcpyb\tR0, NPP"), ["NPP"]);
    assert.match(msg("\tcpyb\tR0, NPP"), /CPYS R0, NPP/);
  });

  test("cpyb R0, TCR は CPYH を案内", () => {
    assert.deepEqual(names("\tcpyb\tR0, TCR"), ["TCR"]);
    assert.match(msg("\tcpyb\tR0, TCR"), /CPYH R0, TCR/);
  });

  test("cpys R0, TSR1 は CPYB を案内", () => {
    assert.deepEqual(names("\tcpys\tR0, TSR1"), ["TSR1"]);
    assert.match(msg("\tcpys\tR0, TSR1"), /CPYB R0, TSR1/);
  });

  test("cpyh R0, TSR0 は CPYB を案内（TSR0 ≠ TSR）", () => {
    assert.deepEqual(names("\tcpyh\tR0, TSR0"), ["TSR0"]);
    assert.match(msg("\tcpyh\tR0, TSR0"), /CPYB R0, TSR0/);
  });

  test("setb R0, NPP は SETS を案内", () => {
    assert.deepEqual(names("\tsetb\tR0, NPP"), ["NPP"]);
    assert.match(msg("\tsetb\tR0, NPP"), /SETS R0, NPP/);
  });

  test("setb R0, CSBR は書き込み禁止", () => {
    assert.deepEqual(names("\tsetb\tR0, CSBR"), ["CSBR"]);
    assert.match(msg("\tsetb\tR0, CSBR"), /直接書き込めない/);
  });

  test("cpyb R0, R1 は第2がベースではない", () => {
    assert.deepEqual(names("\tcpyb\tR0, R1"), ["R1"]);
  });

  test("seth IISR, R0 は語順エラー", () => {
    assert.deepEqual(names("\tseth\tIISR, R0"), ["IISR"]);
    assert.match(msg("\tseth\tIISR, R0"), /SETH は R0, IISR/);
  });

  test("cpys NPP, R0 は SETS を案内", () => {
    assert.deepEqual(names("\tcpys\tNPP, R0"), ["NPP"]);
    assert.match(msg("\tcpys\tNPP, R0"), /SETS R0, NPP/);
  });
});
