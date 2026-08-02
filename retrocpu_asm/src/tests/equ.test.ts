/**
 * .equ 形式の専用テスト
 *
 * 実行: npm test -- --test-name-pattern=equ
 *   または node --require tsx/cjs --test src/tests/equ.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../main/assembler";

describe(".equ 構文バリエーション", () => {
  const cases: Array<{ title: string; src: string; name: string; value: number }> = [
    {
      title: ".equ NAME, imm",
      src: "        .equ PORT, 20\n        .org 0\n        .word PORT\n",
      name: "PORT",
      value: 20,
    },
    {
      title: "NAME: .equ imm",
      src: "PORT:   .equ 20\n        .org 0\n        .word PORT\n",
      name: "PORT",
      value: 20,
    },
    {
      title: "NAME .equ imm（SDAS）",
      src: "PORT .equ 20\n        .org 0\n        .word PORT\n",
      name: "PORT",
      value: 20,
    },
    {
      title: "NAME equ imm",
      src: "PORT equ 20\n        .org 0\n        .word PORT\n",
      name: "PORT",
      value: 20,
    },
    {
      title: "NAME .EQU imm（大文字）",
      src: "PORT .EQU 20\n        .org 0\n        .word PORT\n",
      name: "PORT",
      value: 20,
    },
  ];

  for (const c of cases) {
    test(c.title, () => {
      const r = assemble(c.src);
      assert.equal(r.symbols.get(c.name), c.value);
      assert.equal(r.words[0].value, c.value);
    });
  }
});

describe(".equ 式と依存", () => {
  test("定数同士の加算", () => {
    const r = assemble(
      "A .equ 3\nB .equ 5\nC .equ A + B\n        .org 0\n        .word C\n",
    );
    assert.equal(r.symbols.get("C"), 8);
    assert.equal(r.words[0].value, 8);
  });

  test("シフト・ビット演算", () => {
    const r = assemble(
      "BASE .equ 1\nSHIFT .equ BASE << 4\nMASK .equ SHIFT | 0x03\n        .org 0\n        .word MASK\n",
    );
    assert.equal(r.symbols.get("SHIFT"), 16);
    assert.equal(r.symbols.get("MASK"), 19);
    assert.equal(r.words[0].value, 19);
  });

  test("命令オペランドに .equ を使用（RD）", () => {
    const r = assemble("IO .equ 7\n        .org 0\n        RD R0, IO\n");
    assert.equal(r.words[0].value, 0x1807);
  });

  test("MVI 即値に .equ", () => {
    const r = assemble("IMM .equ 0x55\n        .org 0\n        MVI R0, IMM\n");
    assert.equal(r.symbols.get("IMM"), 0x55);
    assert.equal(r.words[0].value & 0xff, 0x55);
  });
});
