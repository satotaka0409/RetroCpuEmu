import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mn1613Architecture } from "../cpu/mn1613/arch";
import { parseAsmLine } from "../symbols/parseLine";
import { findInvalidAddressingOperands } from "./addressingModes";

describe("findInvalidAddressingOperands", () => {
  const arch = mn1613Architecture;

  /**
   * @param line ソース行
   * @returns 不正名一覧
   */
  function names(line: string): string[] {
    const parsed = parseAsmLine(line, arch);
    return findInvalidAddressingOperands(line, parsed, arch).map((h) => h.name);
  }

  /**
   * @param line ソース行
   * @returns 先頭メッセージ
   */
  function msg(line: string): string {
    const parsed = parseAsmLine(line, arch);
    return findInvalidAddressingOperands(line, parsed, arch)[0]?.message ?? "";
  }

  test("L R0, 4(X0) / ST R0, 1(X1) は問題なし", () => {
    assert.deepEqual(names("\tl\tR0,4(X0)"), []);
    assert.deepEqual(names("\tST\tR0, 1(X1)"), []);
    assert.deepEqual(names("\tL\tR0, (*5)(X1)"), []);
  });

  test("L R0,4(SP) は SP 相対が無い", () => {
    assert.deepEqual(names("\tl\tR0,4(SP)"), ["SP"]);
    assert.match(msg("\tl\tR0,4(SP)"), /SP 相対/);
  });

  test("L R0, (R2) は LR を使う", () => {
    assert.deepEqual(names("\tL\tR0, (R2)"), ["R2"]);
    assert.match(msg("\tL\tR0, (R2)"), /LR /);
  });

  test("ST R0, (R3) は STR を使う", () => {
    assert.deepEqual(names("\tST\tR0, (R3)"), ["R3"]);
    assert.match(msg("\tST\tR0, (R3)"), /STR /);
  });

  test("L R0, 4(TSR0) は LD を使う", () => {
    assert.deepEqual(names("\tL\tR0, 4(TSR0)"), ["TSR0"]);
    assert.match(msg("\tL\tR0, 4(TSR0)"), /LD /);
  });

  test("B (R3) は BR を使う", () => {
    assert.deepEqual(names("\tB\t(R3)"), ["R3"]);
    assert.match(msg("\tB\t(R3)"), /BR /);
  });

  test("LD R0, 0x0300(TSR0) / LD R0, TSR0, LABEL は問題なし", () => {
    assert.deepEqual(names("\tLD\tR0, 0x0300(TSR0)"), []);
    assert.deepEqual(names("\tLD\tR0, TSR0, DEST"), []);
    assert.deepEqual(names("\tLD\tR0, DEST"), []);
  });

  test("LD R0, 4(X0) は L を使う", () => {
    assert.deepEqual(names("\tLD\tR0, 4(X0)"), ["X0"]);
    assert.match(msg("\tLD\tR0, 4(X0)"), /\bL\b/);
  });

  test("LD R0, (R2) は LR を使う", () => {
    assert.deepEqual(names("\tLD\tR0, (R2)"), ["R2"]);
    assert.match(msg("\tLD\tR0, (R2)"), /LR /);
  });

  test("LD R0, 4(OSR0) は BRn 不正", () => {
    assert.deepEqual(names("\tLD\tR0, 4(OSR0)"), ["OSR0"]);
    assert.match(msg("\tLD\tR0, 4(OSR0)"), /TSR0/);
  });

  test("LR R0, (R2) / STR R0, (R1)+ は問題なし", () => {
    assert.deepEqual(names("\tLR\tR0, (R2)"), []);
    assert.deepEqual(names("\tSTR\tR0, (R1)+"), []);
    assert.deepEqual(names("\tLR\tR0, TSR0, (R2)"), []);
  });

  test("LR R0, 4(X0) は L/ST 系", () => {
    assert.deepEqual(names("\tLR\tR0, 4(X0)"), ["X0"]);
    assert.match(msg("\tLR\tR0, 4(X0)"), /L\/ST/);
  });

  test("LR R0, (SP) / (R0) / (X0) は不正", () => {
    assert.deepEqual(names("\tLR\tR0, (SP)"), ["SP"]);
    assert.deepEqual(names("\tLR\tR0, (R0)"), ["R0"]);
    assert.deepEqual(names("\tLR\tR0, (X0)"), ["X0"]);
    assert.match(msg("\tLR\tR0, (X0)"), /\(R3\)/);
  });

  test("BR (R3) / BALR (R4) は問題なし", () => {
    assert.deepEqual(names("\tBR\t(R3)"), []);
    assert.deepEqual(names("\tBALR\t(R4)"), []);
  });

  test("BR DEST は B/BD を使う", () => {
    assert.deepEqual(names("\tBR\tDEST"), ["BR"]);
    assert.match(msg("\tBR\tDEST"), /B \/ BD/);
  });

  test("AWR/RDR の (Ri) は R1–R4", () => {
    assert.deepEqual(names("\tAWR\tR0, (R2), Z"), []);
    assert.deepEqual(names("\tRDR\tR0, (R1)"), []);
    assert.deepEqual(names("\tAWR\tR0, 4(X0)"), ["X0"]);
    assert.deepEqual(names("\tRDR\tR0, (SP)"), ["SP"]);
  });
});
