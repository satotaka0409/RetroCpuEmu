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

import { assemble as assembleCore } from "../main/assembler";
import { expandIncludesFromFile } from "../main/cli";
import type { CpuType } from "../main/types";

/** テスト用。本番 assemble は引数か先頭 `.cpu` が必須 */
function assemble(sourceText: string, cpuType: CpuType = "mn1613") {
  return assembleCore(sourceText, cpuType);
}

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

  test("; @cp の不正名はエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n; @cp 日本語\n        H\n"),
      /invalid checkpoint name/,
    );
  });

  test("; @cp の結び先が無いとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n; @cp dangling\n"),
      /no following instruction/,
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

  test("MVI: 桁の多い 16進は 8bit を超えてエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R0, #0x00000111\n"),
      /out of 8-bit range/i,
    );
  });

  test("MVWI: 16bit 即値 65536 はオーバーフロー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVWI R0, #65536\n"),
      /out of 16-bit range/i,
    );
  });

  test("MVWI: 桁の多い 16進は 16bit を超えてエラー", () => {
    assert.throws(
      () =>
        assemble("        .org 0\n        MVWI R0, #0x0000011100000000\n"),
      /out of 16-bit range/i,
    );
  });

  test("MVWI: #-1 と #0xFFFF は 16bit に収まる", () => {
    const a = assemble("        .org 0\n        MVWI R0, #-1\n");
    const b = assemble("        .org 0\n        MVWI R0, #0xFFFF\n");
    assert.equal(a.words[1]!.value, 0xffff);
    assert.equal(b.words[1]!.value, 0xffff);
  });

  test(".dw: 65536 はオーバーフロー", () => {
    assert.throws(
      () => assemble("        .org 0\n        .dw 65536\n"),
      /out of 16-bit range/i,
    );
  });

  test(".dw: 桁の多い 16進は 16bit を超えてエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        .dw 0x0000011100000000\n"),
      /out of 16-bit range/i,
    );
  });

  test(".dw: -1 は 16bit に収まる", () => {
    const r = assemble("        .org 0\n        .dw -1\n");
    assert.equal(r.words[0]!.value, 0xffff);
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

// ─── 即値の # 必須 ───────────────────────────────────────────────────────────

describe("assembler: エラー系 - 即値は # 必須", () => {
  test("MVI に # が無いとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVI R0, 0x55\n"),
      /immediate operand requires '#'/i,
    );
  });

  test("MVWI に # が無いとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MVWI R0, 0x19\n"),
      /immediate operand requires '#'/i,
    );
  });

  test("MVWI のシンボル即値も # が無いとエラー", () => {
    assert.throws(
      () =>
        assemble(
          "CMD .equ 0x19\n        .org 0\n        MVWI R0, CMD\n",
        ),
      /immediate operand requires '#'/i,
    );
  });

  test("AI に # が無いとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        AI R0, 1\n"),
      /immediate operand requires '#'/i,
    );
  });

  test("ANDI に # が無いとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        ANDI R0, 0x00FF\n"),
      /immediate operand requires '#'/i,
    );
  });

  test("LPSW に # を付けるとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        LPSW #2\n"),
      /LPSW level must not use '#'/i,
    );
  });

  test("LD のアドレスに # を付けるとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        LD R0, #0x0100\n"),
      /address operand must not use '#'/i,
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

// ─── 第1欄（左端）はラベル専用 ───────────────────────────────────────────────

describe("assembler: エラー系 - 疑似命令は字下げ必須", () => {
  test("左端の .org はエラー", () => {
    assert.throws(
      () => assemble(".org 0\n        H\n"),
      /pseudo-op must not start in column 1/i,
    );
  });

  test("左端の .area はエラー", () => {
    assert.throws(
      () => assemble(".area _CODE\n        H\n"),
      /pseudo-op must not start in column 1/i,
    );
  });

  test("字下げした .org は通る", () => {
    assert.doesNotThrow(() => assemble("        .org 0\n        H\n"));
  });

  test("LABEL .equ は左端がラベルなので通る", () => {
    const r = assemble("FOO\t.equ\t0x10\n        .org 0\n        H\n");
    assert.equal(r.symbols.get("FOO"), 0x10);
  });
});

describe("assembler: エラー系 - .area _WORK / .ds", () => {
  test("_WORK に命令はエラー", () => {
    assert.throws(
      () =>
        assemble(`
	.area	_WORK
	.org	0x1700
	H
`),
      /noload area _WORK/i,
    );
  });

  test("_WORK に .word はエラー", () => {
    assert.throws(
      () =>
        assemble(`
	.area	_WORK
	.org	0x1700
	.word	0
`),
      /cannot have initial values/i,
    );
  });

  test(".area に名前が無いとエラー", () => {
    assert.throws(
      () => assemble("        .area\n        H\n"),
      /\.area requires a name/i,
    );
  });

  test("未知の .area フラグはエラー", () => {
    assert.throws(
      () => assemble("        .area _CODE (REL,FOO)\n        H\n"),
      /unknown \.area flag 'FOO'/i,
    );
  });

  test(".ds の引数が無いとエラー", () => {
    assert.throws(
      () =>
        assemble(`
	.area	_WORK
	.org	0x1700
	.ds
`),
      /\.ds requires one argument/i,
    );
  });

  test(".ds はラベルにコロンが必要（NAME .ds は不可）", () => {
    assert.throws(
      () =>
        assemble(`
	.area	_WORK
	.org	0x1700
VAR	.ds	1
`),
      /label must end with ':'/i,
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

  test("CPYB TSR1, R1 は語順エラー（Rd, BRs。書き込みは SETB）", () => {
    assert.throws(
      () => assemble("        .org 0\n        CPYB TSR1, R1\n"),
      /CPYB is Rd, BRs.*SETB R1, TSR1/,
    );
  });

  test("SETB TSR1, R1 は語順エラー（Rs, BRd）", () => {
    assert.throws(
      () => assemble("        .org 0\n        SETB TSR1, R1\n"),
      /SETB is Rs, BRd.*SETB R1, TSR1/,
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

  test("インデックスレジスタは X0/X1 のみ（R2 はエラー）", () => {
    assert.throws(
      () => assemble("        .org 0\n        L R0, 0(R2)\n"),
      /index register must be X0 or X1.*R2/i,
    );
  });

  test("間接インデックスも X0/X1 のみ", () => {
    assert.throws(
      () => assemble("        .org 0\n        L R0, (*0)(R3)\n"),
      /index register must be X0 or X1.*R3/i,
    );
  });

  test("BALR の間接は R1〜R4 のみ（X0 はエラー）", () => {
    assert.throws(
      () => assemble("        .org 0\n        BALR (X0)\n"),
      /Invalid indirect/i,
    );
  });

  test("SL の第2オペランドにレジスタを書くとエラー（EM が必要）", () => {
    assert.throws(
      () => assemble("        .org 0\n        SL R0, R0\n"),
      /Unknown EM operation/i,
    );
  });

  test("CB に #即値はエラー（CBI を使う）", () => {
    assert.throws(
      () => assemble("        .org 0\n        CB R0, #1\n"),
      /Unknown register|#1/i,
    );
  });
});
