/**
 * MN1610 アセンブラ 異常系テストスイート
 *
 * 実行方法:
 *   npm test
 *   # または
 *   node --require tsx/cjs --test src/assembler.error.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { assemble } from "../main/assembler";
import { expandIncludesFromFile } from "../main/cli";

// ─── 未定義命令 ───────────────────────────────────────────────────────────────

describe("assembler: エラー系 - 未定義命令", () => {
  test("存在しないニモニックはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        NOP\n"),
      /Unsupported opcode 'NOP'/,
    );
  });

  test("MN1613 新命令 LD が正しくアセンブルされる（MN1613対応済み）", () => {
    // LD R0, Exp  →  2語命令: [0x2708, AD16]
    const result = assemble("        .org 0\n        LD R0, 0x0100\n");
    assert.equal(result.words.length, 2);
    assert.equal(result.words[0].value, 0x2708); // 00100 111 00CSBR 1R0
    assert.equal(result.words[1].value, 0x0100); // AD16
  });

  test("完全に無効な文字列はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        FOOBAR R0, R1\n"),
      /Unsupported opcode 'FOOBAR'/,
    );
  });

  test("未定義シンボルへの参照はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        B UNDEF\n"),
      /Undefined symbol.*UNDEF/i,
    );
  });

  test("重複ラベルはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\nLOOP:   H\nLOOP:   H\n"),
      /Duplicate symbol.*LOOP/i,
    );
  });

  test("引数が少なすぎる命令はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R0\n"),
      /expects/i,
    );
  });

  test("引数が多すぎる命令はエラー", () => {
    assert.throws(() => assemble("        .org 0\n        H R0\n"), /expects/i);
  });

  test("8bit 範囲外の即値はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R0, #256\n"),
      /out of 8-bit range/i,
    );
  });

  test("相対アドレスが 8bit 符号付き範囲外はエラー", () => {
    const lines = ["        .org 0\n        B FAR\n"];
    for (let i = 0; i < 200; i++) lines.push("        H\n");
    lines.push("FAR:    H\n");
    assert.throws(() => assemble(lines.join("")), /out of signed 8-bit range/i);
  });
});

// ─── 未定義レジスタ ───────────────────────────────────────────────────────────

describe("assembler: エラー系 - 未定義レジスタ", () => {
  test("存在しないレジスタ R9 はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R9, #0\n"),
      /Unknown register.*R9/i,
    );
  });

  test("存在しないレジスタ R5 はエラー（SP として指定する必要がある）", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R5, #0\n"),
      /Unknown register.*R5/i,
    );
  });

  test("完全に無効なレジスタ名はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        A XX, R0\n"),
      /Unknown register.*XX/i,
    );
  });

  test("L/ST 命令で STR を使うとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        L STR, 0\n"),
      /STR.*not allowed|Unknown register|out of/i,
    );
  });
});

// ─── 即値オーバーフロー ───────────────────────────────────────────────────────

describe("assembler: エラー系 - 即値オーバーフロー", () => {
  test("AI: 4bit 即値 16 はオーバーフロー（0〜15 が有効）", () => {
    assert.throws(
      () => assemble("        .org 0\n        AI R0, #16\n"),
      /out of 4-bit range/i,
    );
  });

  test("SI: 4bit 即値 -1 はオーバーフロー", () => {
    assert.throws(
      () => assemble("        .org 0\n        SI R0, #-1\n"),
      /out of 4-bit range/i,
    );
  });

  test("SBIT: ビット番号 16 はオーバーフロー（0〜15 が有効）", () => {
    assert.throws(
      () => assemble("        .org 0\n        SBIT R0, #16\n"),
      /out of 4-bit range/i,
    );
  });

  test("TBIT: ビット番号 16 はオーバーフロー", () => {
    assert.throws(
      () => assemble("        .org 0\n        TBIT R0, #16\n"),
      /out of 4-bit range/i,
    );
  });

  test("RBIT: ビット番号 -1 はオーバーフロー", () => {
    assert.throws(
      () => assemble("        .org 0\n        RBIT R0, #-1\n"),
      /out of 4-bit range/i,
    );
  });

  test("MVI: 8bit 即値 256 はオーバーフロー（0〜255 が有効）", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R0, #256\n"),
      /out of 8-bit range/i,
    );
  });

  test("RD: I/O アドレス 256 はオーバーフロー", () => {
    assert.throws(
      () => assemble("        .org 0\n        RD R0, #256\n"),
      /out of 8-bit range/i,
    );
  });

  test("LPSW: レベル 4 は 2bit 範囲外", () => {
    assert.throws(
      () => assemble("        .org 0\n        LPSW 4\n"),
      /out of 2-bit range/i,
    );
  });
});

// ─── 相対アドレス範囲外 ───────────────────────────────────────────────────────

describe("assembler: エラー系 - 相対アドレス範囲外", () => {
  test("前方向: +128 ワード先は符号付き 8bit を超える（+127 が上限）", () => {
    const lines = ["        .org 0\n        B FAR\n"];
    for (let i = 0; i < 128; i++) lines.push("        H\n");
    lines.push("FAR:    H\n");
    assert.throws(() => assemble(lines.join("")), /out of signed 8-bit range/i);
  });

  test("後方向: -131 ワード前は符号付き 8bit を超える（-128 が下限）", () => {
    const lines = ["FAR:    H\n"];
    for (let i = 0; i < 130; i++) lines.push("        H\n");
    lines.push("        B FAR\n");
    assert.throws(() => assemble(lines.join("")), /out of signed 8-bit range/i);
  });

  test("L 命令でも相対アドレス範囲外はエラー", () => {
    const lines = ["        .org 0\n        L R0, FAR\n"];
    for (let i = 0; i < 200; i++) lines.push("        H\n");
    lines.push("FAR:    .word 0\n");
    assert.throws(() => assemble(lines.join("")), /out of signed 8-bit range/i);
  });
});

// ─── 未定義ラベル ─────────────────────────────────────────────────────────────

describe("assembler: エラー系 - 未定義ラベル", () => {
  test("分岐先ラベルが未定義はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        B MISSING\n"),
      /Undefined symbol.*MISSING/i,
    );
  });

  test("ロード命令のアドレスが未定義ラベルはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        L R0, MISSING\n"),
      /Undefined symbol.*MISSING/i,
    );
  });

  test("ストア命令のアドレスが未定義ラベルはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        ST R0, MISSING\n"),
      /Undefined symbol.*MISSING/i,
    );
  });

  test("BAL のジャンプ先が未定義ラベルはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        BAL MISSING\n"),
      /Undefined symbol.*MISSING/i,
    );
  });

  test(".word で未定義シンボルを参照するとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        .word UNDEF_CONST\n"),
      /Undefined symbol.*UNDEF_CONST/i,
    );
  });
});

// ─── INCLUDE エラー系 ─────────────────────────────────────────────────────────

describe("INCLUDE: エラー系", () => {
  test("循環インクルードは例外を投げる", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn1610-test-"));
    try {
      fs.writeFileSync(path.join(tmpDir, "a.asm"), 'INCLUDE "b.asm"\n');
      fs.writeFileSync(path.join(tmpDir, "b.asm"), 'INCLUDE "a.asm"\n');

      assert.throws(
        () => expandIncludesFromFile(path.join(tmpDir, "a.asm")),
        /Include cycle detected/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("存在しないインクルードファイルは例外を投げる", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn1610-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "main.asm"),
        'INCLUDE "notexist.asm"\n',
      );

      assert.throws(
        () => expandIncludesFromFile(path.join(tmpDir, "main.asm")),
        /Include file not found/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── MN1613 固有のエラー系 ────────────────────────────────────────────────────

describe("assembler: エラー系 - MN1613 固有制約", () => {
  test("STB CSBR はCSBR直接書き込み禁止エラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        STB CSBR, 0\n"),
      /CSBR cannot be written directly/,
    );
  });

  test("SETB CSBR はCSBR直接書き込み禁止エラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        SETB R0, CSBR\n"),
      /CSBR cannot be written directly/,
    );
  });

  test("不正な間接レジスタ指定はエラー", () => {
    // LR の間接レジスタは R1〜R4 のみ、R0 は不可
    assert.throws(
      () => assemble("        .org 0\n        LR R0, (R0)\n"),
      /Invalid indirect/i,
    );
  });

  test("不正な間接記法はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        LR R0, R1\n"),
      /Invalid indirect/i,
    );
  });

  test("未知のベースレジスタはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        LB INVALID, 0\n"),
      /Unknown base register/i,
    );
  });

  test("未知の特殊レジスタはエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        LS INVALID, 0\n"),
      /Unknown special register/i,
    );
  });
});
