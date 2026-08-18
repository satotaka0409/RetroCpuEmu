/**
 * MN1610 アセンブラ 正常系テストスイート
 *
 * 実行方法:
 *   npm test
 *   # または
 *   node --require tsx/cjs --test src/assembler.test.ts
 *
 * 異常系テストは assembler.error.test.ts を参照。
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { evalExpr } from "../main/expression";
import { assemble as assembleCore } from "../main/assembler";
import { writeLst } from "../main/lstWriter";
import { writeRel } from "../main/relWriter";
import { expandIncludesFromFile } from "../main/cli";
import type { CpuType } from "../main/types";

/** テスト用。本番 assemble は引数か先頭 `.cpu` が必須 */
function assemble(sourceText: string, cpuType: CpuType = "mn1613") {
  return assembleCore(sourceText, cpuType);
}

// ─── 式評価 ──────────────────────────────────────────────────────────────────

describe("evalExpr: 文字リテラル", () => {
  const empty = new Map<string, number>();

  test("'A' は ASCII 0x41", () => {
    assert.equal(evalExpr("'A'", empty, false), 0x41);
  });

  test("空白と演算", () => {
    assert.equal(evalExpr("' '", empty, false), 0x20);
    assert.equal(evalExpr("'A' + 1", empty, false), 0x42);
  });

  test("閉じない文字リテラルはエラー", () => {
    assert.throws(
      () => evalExpr("'A", empty, false),
      /Invalid character literal/,
    );
  });
});

describe("evalExpr: len()", () => {
  const empty = new Map<string, number>();
  const lenses = new Map<string, number>([
    ["HELLO_MSG1", 11],
    ["AB", 2],
  ]);

  test("len(HELLO_MSG1) は 11（MN1613 ではワード数）", () => {
    assert.equal(evalExpr("len(HELLO_MSG1)", empty, false, lenses), 11);
  });

  test("LEN 大文字と空白", () => {
    assert.equal(evalExpr("LEN( AB )", empty, false, lenses), 2);
  });

  test("式の中で使える", () => {
    assert.equal(evalExpr("len(AB) + 1", empty, false, lenses), 3);
  });

  test("文字列リテラルはエラー", () => {
    assert.throws(
      () => evalExpr('len("HELLO")', empty, false, lenses),
      /len\(\) requires a string label/,
    );
  });

  test("数値はエラー", () => {
    assert.throws(
      () => evalExpr("len(5)", empty, false, lenses),
      /len\(\) requires a string label/,
    );
  });

  test("文字列でないラベルはエラー", () => {
    assert.throws(
      () => evalExpr("len(NOT_STR)", empty, false, lenses),
      /len\(\) requires a string label/,
    );
  });

  test("グローバルラベルはエラー", () => {
    const globl = new Set(["HELLO_MSG1"]);
    assert.throws(
      () => evalExpr("len(HELLO_MSG1)", empty, false, lenses, globl),
      /len\(\) cannot use a global label/,
    );
  });
});

describe("assembler: ASCII .dw", () => {
  test(".dw 'H' は 0x0048", () => {
    const r = assemble("        .org 0\n        .dw 'H'\n");
    assert.equal(r.words[0]!.value, 0x48);
  });

  test('.dw "HELLO WORLD" は 1 文字 1 ワード', () => {
    const r = assemble('        .org 0\n        .dw "HELLO WORLD"\n');
    const expect = [..."HELLO WORLD"].map((c) => c.charCodeAt(0));
    assert.deepEqual(
      r.words.map((w) => w.value),
      expect,
    );
  });

  test("MVI 即値に #'0' が使える", () => {
    const r = assemble("        .org 0\n        MVI R0, #'0'\n");
    assert.equal(r.words[0]!.value, 0x0830);
  });
});

describe("evalExpr: リテラル", () => {
  const empty = new Map<string, number>();

  test("10進数", () => {
    assert.equal(evalExpr("0", empty, false), 0);
    assert.equal(evalExpr("42", empty, false), 42);
    assert.equal(evalExpr("255", empty, false), 255);
  });

  test("16進数 0x prefix", () => {
    assert.equal(evalExpr("0xFF", empty, false), 255);
    assert.equal(evalExpr("0x100", empty, false), 256);
    assert.equal(evalExpr("0xFFFF", empty, false), 65535);
  });

  test("16進数 H suffix（数字始まり）", () => {
    assert.equal(evalExpr("10H", empty, false), 16);
    assert.equal(evalExpr("0H", empty, false), 0);
    assert.equal(evalExpr("1AH", empty, false), 26);
  });

  test("2進数 B suffix", () => {
    assert.equal(evalExpr("1010B", empty, false), 10);
    assert.equal(evalExpr("11111111B", empty, false), 255);
    assert.equal(evalExpr("0B", empty, false), 0);
  });
});

// ── 数値リテラル全形式 ──────────────────────────────────────────────────────

describe("evalExpr: 数値リテラル全形式", () => {
  const empty = new Map<string, number>();

  test("16進数: 0x/0X prefix（大文字・小文字 suffix 両対応）", () => {
    assert.equal(evalExpr("0xFF", empty, false), 255);
    assert.equal(evalExpr("0XFF", empty, false), 255); // 大文字 X
    assert.equal(evalExpr("0xff", empty, false), 255); // 小文字
    assert.equal(evalExpr("0xABCD", empty, false), 0xabcd);
    assert.equal(evalExpr("0xabcd", empty, false), 0xabcd); // 小文字 A-F
  });

  test("16進数: H suffix（A-F を含む値、先頭に 0 を付ける）", () => {
    assert.equal(evalExpr("10H", empty, false), 16); // 0x10
    assert.equal(evalExpr("10h", empty, false), 16); // 小文字 suffix
    assert.equal(evalExpr("1AH", empty, false), 26); // A を含む値
    assert.equal(evalExpr("0FFH", empty, false), 255); // A-F 始まりは先頭 0
    assert.equal(evalExpr("0abH", empty, false), 171); // 小文字 a-f
    assert.equal(evalExpr("0abh", empty, false), 171); // suffix も小文字
  });

  test("8進数: 0o/0O prefix", () => {
    assert.equal(evalExpr("0o0", empty, false), 0);
    assert.equal(evalExpr("0o7", empty, false), 7);
    assert.equal(evalExpr("0o10", empty, false), 8); // 8進 10 = 10進 8
    assert.equal(evalExpr("0o17", empty, false), 15);
    assert.equal(evalExpr("0O377", empty, false), 255); // 大文字 O
  });

  test("8進数: Q suffix（アセンブラ慣習）", () => {
    assert.equal(evalExpr("0Q", empty, false), 0);
    assert.equal(evalExpr("17Q", empty, false), 15);
    assert.equal(evalExpr("377Q", empty, false), 255);
    assert.equal(evalExpr("17q", empty, false), 15); // 小文字 suffix
  });

  test("8進数: O suffix", () => {
    assert.equal(evalExpr("17O", empty, false), 15);
    assert.equal(evalExpr("17o", empty, false), 15); // 小文字 suffix
    assert.equal(evalExpr("377O", empty, false), 255);
  });

  test("2進数: 0b/0B prefix", () => {
    assert.equal(evalExpr("0b0", empty, false), 0);
    assert.equal(evalExpr("0b1", empty, false), 1);
    assert.equal(evalExpr("0b1010", empty, false), 10);
    assert.equal(evalExpr("0B11111111", empty, false), 255);
    assert.equal(evalExpr("0b1000000000000000", empty, false), 0x8000); // 1<<15（MSB）。MN1613 のビット15（LSB）は 0x0001
  });

  test("2進数: B suffix（既存、小文字も可）", () => {
    assert.equal(evalExpr("1010B", empty, false), 10);
    assert.equal(evalExpr("11111111b", empty, false), 255); // 小文字 suffix
  });

  test("10進数: D suffix（既存、小文字も可）", () => {
    assert.equal(evalExpr("42D", empty, false), 42);
    assert.equal(evalExpr("255d", empty, false), 255); // 小文字 suffix
  });

  test("異なる基数の混在（式の中）", () => {
    // 0xFF(255) + 0b1010(10) + 17Q(15) = 280
    assert.equal(evalExpr("0xFF + 0b1010 + 17Q", empty, false), 280);
    // 0o10(8) * 10H(16) = 128
    assert.equal(evalExpr("0o10 * 10H", empty, false), 128);
  });

  test("8進数の乗算・加算", () => {
    // 0O10 * 2 = 8 * 2 = 16
    assert.equal(evalExpr("0O10 * 2", empty, false), 16);
    // 377Q + 1Q = 255 + 1 = 256
    assert.equal(evalExpr("377Q + 1Q", empty, false), 256);
  });
});

describe("evalExpr: シンボル参照", () => {
  const sym = new Map<string, number>([
    ["ABC", 10],
    ["BASE", 0x100],
    ["FLAG", 1],
  ]);

  test("定義済みシンボルの値を返す", () => {
    assert.equal(evalExpr("ABC", sym, false), 10);
    assert.equal(evalExpr("BASE", sym, false), 0x100);
    assert.equal(evalExpr("FLAG", sym, false), 1);
  });

  test("シンボル参照は大文字小文字を区別しない", () => {
    assert.equal(evalExpr("abc", sym, false), 10);
    assert.equal(evalExpr("Abc", sym, false), 10);
    assert.equal(evalExpr("ABC", sym, false), 10);
  });

  test("allowUndefined=true で未定義シンボルは 0 を返す", () => {
    assert.equal(evalExpr("UNDEF", sym, true), 0);
  });

  test("allowUndefined=false で未定義シンボルは例外", () => {
    assert.throws(() => evalExpr("UNDEF", sym, false), /Undefined symbol/);
  });
});

describe("evalExpr: 演算子優先順位", () => {
  const sym = new Map<string, number>([
    ["ABC", 10],
    ["III", 3],
  ]);

  test("* は + より優先される", () => {
    // 10 + (3 * 8) = 34
    assert.equal(evalExpr("ABC + III * 8", sym, false), 34);
  });

  test("括弧で優先順位を変更できる", () => {
    // (10 + 3) * 8 = 104
    assert.equal(evalExpr("(ABC + III) * 8", sym, false), 104);
  });

  test("/ は + より優先される", () => {
    // 10 + (20 / 4) = 15
    assert.equal(evalExpr("ABC + 20 / 4", sym, false), 15);
  });

  test("複合: ABC + III * 8 - 1", () => {
    // 10 + 24 - 1 = 33
    assert.equal(evalExpr("ABC + III * 8 - 1", sym, false), 33);
  });

  test("ネスト括弧: (ABC + 2) * (III - 1)", () => {
    // 12 * 2 = 24
    assert.equal(evalExpr("(ABC + 2) * (III - 1)", sym, false), 24);
  });

  test("加減算の左結合", () => {
    // (10 - 3 + 2) = 9
    assert.equal(evalExpr("ABC - III + 2", sym, false), 9);
  });
});

describe("evalExpr: 単項演算子", () => {
  const empty = new Map<string, number>();

  test("単項マイナス", () => {
    assert.equal(evalExpr("-5 + 10", empty, false), 5);
    assert.equal(evalExpr("-(3 + 2)", empty, false), -5);
  });

  test("単項プラス（値をそのまま返す）", () => {
    assert.equal(evalExpr("+42", empty, false), 42);
  });

  test("~ ビット反転（16bit）", () => {
    assert.equal(evalExpr("~0xFF00", empty, false), 0x00ff);
    assert.equal(evalExpr("~0x0001", empty, false), 0xfffe);
    assert.equal(evalExpr("~0x0000", empty, false), 0xffff);
  });
});

describe("evalExpr: 乗除剰余", () => {
  const empty = new Map<string, number>();

  test("乗算 *", () => assert.equal(evalExpr("6 * 7", empty, false), 42));
  test("除算 / （切り捨て）", () =>
    assert.equal(evalExpr("30 / 4", empty, false), 7));
  test("剰余 %", () => assert.equal(evalExpr("30 % 7", empty, false), 2));
  test("ゼロ除算は例外", () => {
    assert.throws(() => evalExpr("5 / 0", empty, false), /Division by zero/);
  });
  test("ゼロ剰余は例外", () => {
    assert.throws(() => evalExpr("5 % 0", empty, false), /Modulo by zero/);
  });
});

describe("evalExpr: シフト演算子", () => {
  const empty = new Map<string, number>();

  test("左シフト <<", () => {
    assert.equal(evalExpr("1 << 4", empty, false), 16);
    assert.equal(evalExpr("1 << 8", empty, false), 256);
  });

  test("右シフト >> （論理シフト）", () => {
    assert.equal(evalExpr("0xFF00 >> 4", empty, false), 0x0ff0);
    assert.equal(evalExpr("256 >> 1", empty, false), 128);
  });

  test("シフト結果は 16bit にマスクされる", () => {
    assert.equal(evalExpr("1 << 15", empty, false), 0x8000);
    assert.equal(evalExpr("1 << 16", empty, false), 0);
  });

  test("<< は + より優先順位が低い", () => {
    // C 標準の優先順位: + は << より高い
    // (2 + 1) << 2 = 3 << 2 = 12
    assert.equal(evalExpr("2 + 1 << 2", empty, false), 12);
  });
});

describe("evalExpr: ビット演算子", () => {
  const empty = new Map<string, number>();

  test("AND &", () =>
    assert.equal(evalExpr("0xFF & 0x0F", empty, false), 0x0f));
  test("OR  |", () =>
    assert.equal(evalExpr("0xF0 | 0x0F", empty, false), 0xff));
  test("XOR ^", () =>
    assert.equal(evalExpr("0xAA ^ 0xFF", empty, false), 0x55));

  test("優先順位: & は | より強い", () => {
    // 0xF0 | (0xFF & 0x0F) = 0xF0 | 0x0F = 0xFF
    assert.equal(evalExpr("0xF0 | 0xFF & 0x0F", empty, false), 0xff);
  });

  test("優先順位: ^ は | より強い", () => {
    // 0xFF | (0xAA ^ 0xFF) = 0xFF | 0x55 = 0xFF
    assert.equal(evalExpr("0xFF | 0xAA ^ 0xFF", empty, false), 0xff);
  });

  test("ビット演算と算術演算の組み合わせ", () => {
    // (0xFF & (3 * 4)) | 0x80 = (0xFF & 0x0C) | 0x80 = 0x0C | 0x80 = 0x8C
    assert.equal(evalExpr("0xFF & 3 * 4 | 0x80", empty, false), 0x8c);
  });
});

// ─── アセンブル出力 ───────────────────────────────────────────────────────────

// sum1to10 相当のソース（コメント・空白行なし版）
const SUM1TO10_SRC = `\
        .org 0
        .globl START
        .globl LOOP
        .globl RESULT
START:  MVI R0, #0
        MVI R1, #10
LOOP:   A R0, R1
        SI R1, #1, Z
        B LOOP
        ST R0, RESULT
        H
RESULT: .word 0
`;

describe("assembler: 基本命令エンコード", () => {
  test("MVI R0, #0 → 0x0800", () => {
    const r = assemble("        .org 0\n        MVI R0, #0\n");
    assert.equal(r.words[0].value, 0x0800);
  });

  test("MVI R1, #10 → 0x090A", () => {
    const r = assemble("        .org 0\n        MVI R1, #10\n");
    assert.equal(r.words[0].value, 0x090a);
  });

  test("A R0, R1 → 0x5809", () => {
    const r = assemble("        .org 0\n        A R0, R1\n");
    assert.equal(r.words[0].value, 0x5809);
  });

  test("SI R1, #1, Z → 0x4141", () => {
    const r = assemble("        .org 0\n        SI R1, #1, Z\n");
    assert.equal(r.words[0].value, 0x4141);
  });

  test("H → 0x2000", () => {
    const r = assemble("        .org 0\n        H\n");
    assert.equal(r.words[0].value, 0x2000);
  });

  test(".word 定数値", () => {
    const r = assemble("        .org 0\n        .word 0x1234\n");
    assert.equal(r.words[0].value, 0x1234);
  });

  test("ラベルの相対分岐が正しくエンコードされる", () => {
    // B LOOP: LOOP=addr2, 命令=addr4, rel=2-4=-2=0xFE
    // B: 11 001 111 11111110 = 0xCFFE
    const r = assemble(SUM1TO10_SRC);
    const bInstr = r.words.find((w) => w.address === 4);
    assert.ok(bInstr, "B instruction not found");
    assert.equal(bInstr.value, 0xcffe);
  });
});

/**
 * ラベル引き算 END - START。
 * START〜END の間に H が 3 命令あるので、差分はワード数 3（バイト数 6 ではない）。
 */
describe("assembler: ラベル引き算 END - START", () => {
  test("1. 両方ともファイル内ラベルの場合（ワード数）", () => {
    const src = `
        .org    0
START:  H
        H
        H
END:
SIZE:   .equ    END - START
        .word   SIZE
        .word   END - START
`;
    const r = assemble(src);
    assert.equal(r.symbols.get("START"), 0);
    assert.equal(r.symbols.get("END"), 3);
    assert.equal(
      r.symbols.get("SIZE"),
      3,
      "ファイル内ラベル同士の差はワード数",
    );
    assert.equal(r.words[3].value, 0x0003, ".word SIZE");
    assert.equal(r.words[4].value, 0x0003, ".word END - START");
  });

  test("2. 片方がグローバルラベルの場合（ワード数）", () => {
    const src = `
        .org    0
        .globl  START
START:  H
        H
        H
END:
SIZE:   .equ    END - START
        .word   SIZE
        .word   END - START
`;
    const r = assemble(src);
    assert.equal(r.symbols.get("START"), 0);
    assert.equal(r.symbols.get("END"), 3);
    assert.equal(r.symbols.get("SIZE"), 3, "片方が .globl でも差はワード数");
    assert.equal(r.words[3].value, 0x0003, ".word SIZE");
    assert.equal(r.words[4].value, 0x0003, ".word END - START");
  });

  test("3. 両方が同ファイルのグローバル定義の場合（ワード数・アセンブル時確定）", () => {
    const src = `
        .org    0
        .globl  START
        .globl  END
START:  H
        H
        H
END:
SIZE:   .equ    END - START
        .word   SIZE
        .word   END - START
`;
    const r = assemble(src);
    assert.equal(r.symbols.get("START"), 0);
    assert.equal(r.symbols.get("END"), 3);
    assert.equal(
      r.symbols.get("SIZE"),
      3,
      "両方 .globl でも同ファイル定義なら差はワード数",
    );
    assert.equal(r.words[3].value, 0x0003, ".word SIZE");
    assert.equal(r.words[4].value, 0x0003, ".word END - START");
    assert.equal(r.symbolInfos.get("START")?.kind, "global");
    assert.equal(r.symbolInfos.get("END")?.kind, "global");
  });
});

/**
 * 外部ラベル同士の引き算は sdld が差リロケーションを持たないのでアセンブル時エラー。
 * 同一モジュール内の差は定数として確定する（上の describe）。
 */
describe("assembler: 外部ラベル引き算 END - START", () => {
  const useSrc = `
        .org    0
        .globl  START
        .globl  END
        .word   END - START
`;

  test("参照側アセンブル: START/END は external、A-B はエラー", () => {
    const r = assemble(`
        .org    0
        .globl  START
        .globl  END
        H
`);
    assert.equal(r.symbolInfos.get("START")?.kind, "external");
    assert.equal(r.symbolInfos.get("END")?.kind, "external");
    assert.throws(
      () => assemble(useSrc),
      /unsupported external expression 'END - START'/,
    );
  });

  test("定義側 .rel: Def はバイトアドレス（START=0, END=6）", () => {
    const rel = writeRel(
      assemble(`
        .org    0
        .globl  START
        .globl  END
START:  H
        H
        H
END:
`),
      "DEFS",
    );
    assert.ok(rel.includes("S START Def0000"), rel);
    assert.ok(rel.includes("S END Def0006"), rel);
    assert.ok(!rel.includes("Ref"), "定義側に Ref は出ない");
    assert.ok(!rel.includes("\nW "), "定義側に W は出ない");
  });
});

/**
 * 外部ラベルへの BALD / .dw は asxxxx R レコード（R3_SYM）。
 */
describe("assembler: 外部ラベル BALD / .dw 絶対リロケーション", () => {
  test("BALD 外部は第2語プレースホルダ + symbol reloc", () => {
    const r = assemble(`
        .globl  FOO
        bald    FOO
        h
`);
    assert.equal(r.symbolInfos.get("FOO")?.kind, "external");
    assert.equal(r.words[0]!.value, 0x2617);
    assert.equal(r.words[1]!.value, 0x0000, "リンク前はプレースホルダ");
    assert.equal(r.relocs.length, 1);
    assert.deepEqual(r.relocs[0], {
      byteAddr: 2,
      left: { kind: "symbol", name: "FOO" },
      right: { kind: "const", value: 0 },
      area: "_CODE",
    });
  });

  test(".dw 外部もプレースホルダ + symbol reloc", () => {
    const r = assemble(`
        .globl  BAR
        .dw     BAR
`);
    assert.equal(r.words[0]!.value, 0x0000);
    assert.equal(r.relocs.length, 1);
    assert.deepEqual(r.relocs[0], {
      byteAddr: 0,
      left: { kind: "symbol", name: "BAR" },
      right: { kind: "const", value: 0 },
      area: "_CODE",
    });
  });

  test("BALD 外部の .rel は T の直後に R（R3_SYM）", () => {
    const rel = writeRel(
      assemble(`
        .globl  FOO
        bald    FOO
        h
`),
      "USE",
    );
    assert.ok(rel.includes("S FOO Ref0000"), rel);
    assert.match(rel, /^T 00 00 26 17 00 00 20 00$/m);
    assert.match(rel, /^R 00 00 00 00 02 04 00 01$/m);
  });
});

/**
 * 外部ラベルとローカルラベルの引き算は sdld 非対応。
 */
describe("assembler: 外部×ローカル ラベル引き算", () => {
  test("END - LOCAL はアセンブル時エラー", () => {
    assert.throws(
      () =>
        assemble(`
        .org    0
        .globl  END
LOCAL:
        .word   END - LOCAL
`),
      /unsupported external expression/,
    );
  });

  test("LOCAL - END はアセンブル時エラー", () => {
    assert.throws(
      () =>
        assemble(`
        .org    0
        .globl  END
LOCAL:
        .word   LOCAL - END
`),
      /unsupported external expression/,
    );
  });
});

describe("assembler: REL ファイル出力", () => {
  test("sum1to10 の命令バイト列 (T レコード) が正しい", () => {
    const rel = writeRel(assemble(SUM1TO10_SRC), "SUM1TO10");
    assert.match(rel, /^T 00 00 08 00 09 0A 58 09 41 41 CF FE 88 02 20 00$/m);
    assert.match(rel, /^T 00 0E 00 00$/m);
    assert.match(rel, /^R 00 00 00 00$/m);
  });

  test("sum1to10 のシンボルが正しいバイトアドレスでエクスポートされる", () => {
    const rel = writeRel(assemble(SUM1TO10_SRC), "SUM1TO10");
    assert.ok(rel.includes("S LOOP Def0004"), `LOOP symbol:\n${rel}`);
    assert.ok(rel.includes("S RESULT Def000E"), `RESULT symbol:\n${rel}`);
    assert.ok(rel.includes("S START Def0000"), `START symbol:\n${rel}`);
    assert.ok(
      !rel.includes("S SIZE "),
      "ローカルでない未宣言シンボルは出さない",
    );
  });

  test("複数 .area の A レコードは _CODE → _DATA → _WORK", () => {
    const rel = writeRel(
      assemble(`
	.area	_WORK		(REL,NOLOAD)
W0:	.ds	1
	.area	_DATA		(REL,CON)
	.dw	1
	.area	_CODE		(REL,CON)
	H
`),
      "AREAS",
    );
    const aOrder = [...rel.matchAll(/^A\s+(\S+)/gm)].map((m) => m[1]);
    assert.deepEqual(aOrder, ["_CODE", "_DATA", "_WORK"]);
    assert.match(rel, /A _WORK size 0002 flags 0000/);
  });

  test("A レコードは _BIOS が _CODE の前", () => {
    const rel = writeRel(
      assemble(`
	.area	_CODE		(REL,CON)
	H
	.area	_BIOS		(REL,CON)
	H
`),
      "BIOSORD",
    );
    const aOrder = [...rel.matchAll(/^A\s+(\S+)/gm)].map((m) => m[1]);
    assert.deepEqual(aOrder, ["_BIOS", "_CODE"]);
  });

  test("*label ゼロページは R3_BYTE（P レコードは出さない）", () => {
    const rel = writeRel(
      assemble(`
	.area	_CODE		(REL,CON)
	.globl	GL_RND_SEED
	ST	R0, *GL_RND_SEED
	.area	_SYS_PAGE0		(REL,NOLOAD)
GL_RND_SEED:	.ds	1
`),
      "ZP",
    );
    assert.ok(!rel.includes("\nP "), rel);
    assert.match(rel, /^S GL_RND_SEED Def0000$/m);
    assert.match(rel, /A _SYS_PAGE0 size 0002 flags 0000/);
    assert.match(rel, /^R 00 00 00 01 03 03 00 01$/m);
  });

  test("(*label) ゼロページ間接も R3_BYTE", () => {
    const rel = writeRel(
      assemble(`
	.area	_CODE		(REL,CON)
	.globl	GL_BAL_TMP
	ST	R1, *GL_BAL_TMP
	BAL	(*GL_BAL_TMP)
	.area	_SYS_PAGE0		(REL,NOLOAD)
GL_BAL_TMP:	.ds	1
`),
      "ZPIND",
    );
    assert.ok(!rel.includes("\nP "), rel);
    const rLines = rel.split("\n").filter((l) => l.startsWith("R "));
    assert.ok(
      rLines.some((l) => l.includes("03 03")),
      rel,
    );
    assert.ok(
      rLines.some((l) => l.includes("03 05")),
      rel,
    );
  });

  test("REL ヘッダーが正しい", () => {
    const rel = writeRel(assemble(SUM1TO10_SRC), "SUM1TO10");
    const lines = rel.split("\n");
    assert.equal(lines[0], "XH2");
    assert.ok(rel.includes("M SUM1TO10"));
    assert.ok(rel.includes("A _CODE size 0010 flags 0000"));
    assert.ok(rel.includes("H 1 areas 4 global symbols"));
    assert.ok(rel.includes("S .__.ABS. Def0000"));
    assert.equal(lines[lines.length - 2], "E");
  });

  test(".globl なしのローカルラベルは REL に出ない", () => {
    const rel = writeRel(assemble("        .org 0\nLOCAL:  H\n"), "LOCALMOD");
    assert.ok(!rel.includes("S LOCAL"), rel);
    assert.ok(rel.includes("H 1 areas 1 global symbols"), rel);
  });

  test("カスタムモジュール名が反映される", () => {
    const rel = writeRel(assemble("        .org 0\n        H\n"), "MYMOD");
    assert.ok(rel.includes("M MYMOD"));
  });

  test("; @cp は REL に S __CP$name$serial Def（バイトアドレス）", () => {
    const rel = writeRel(
      assemble(`
	.cpu	mn1613
	.area	_CODE		(REL,CON)
	.org	0x2097
; @cp abcdefg
	H
`),
      "CPMOD",
    );
    assert.match(rel, /^S __CP\$abcdefg\$0001 Def412E$/m);
    assert.ok(!rel.includes("L:__CP"), rel);
  });

  test("同名 @cp は serial 0001/0002、同一ワードでもエラーにしない", () => {
    const rel = writeRel(
      assemble(`
	.cpu	mn1613
	.area	_CODE		(REL,CON)
	.org	0
; @cp gl_get_rnd
; @cp gl_get_rnd
	H
`),
      "CP2",
    );
    assert.match(rel, /^S __CP\$gl_get_rnd\$0001 Def0000$/m);
    assert.match(rel, /^S __CP\$gl_get_rnd\$0002 Def0000$/m);
  });
});

describe("assembler: LST ファイル出力", () => {
  test("sum1to10 の全命令でアドレスとオペコードが正しい", () => {
    const lst = writeLst(assemble(SUM1TO10_SRC));
    const checks: [string, string][] = [
      ["0000 0800", "MVI R0, #0"],
      ["0001 090A", "MVI R1, #10"],
      ["0002 5809", "A R0, R1"],
      ["0003 4141", "SI R1, #1, Z"],
      ["0004 CFFE", "B LOOP"],
      ["0005 8802", "ST R0, RESULT"],
      ["0006 2000", "H"],
      ["0007 0000", ".word 0"],
    ];
    for (const [pat, desc] of checks) {
      assert.ok(lst.includes(pat), `${desc}: 期待 "${pat}"\n${lst}`);
    }
  });

  test("LST にラベルが含まれる", () => {
    const lst = writeLst(assemble(SUM1TO10_SRC));
    assert.ok(lst.includes("START:"), "label START");
    assert.ok(lst.includes("LOOP:"), "label LOOP");
    assert.ok(lst.includes("RESULT:"), "label RESULT");
  });

  test(".ds / .blkw 行にロケーションアドレスが出る（オペコードは出ない）", () => {
    const lst = writeLst(
      assemble(`
	.area	_SYS_PAGE0		(ABS,NOLOAD)
	.org	0x0008
GL_RND_SEED:	.ds	1
		.ds	1
	.area	_WORK		(REL,NOLOAD)
BUF:	.ds	2
X:	.blkw	1
`),
    );
    assert.match(lst, /^0008\s+GL_RND_SEED:\t\.ds\t1/m);
    assert.match(lst, /^0009\s+\.ds\t1/m);
    assert.match(lst, /^0000\s+BUF:\t\.ds\t2/m);
    assert.match(lst, /^0002\s+X:\t\.blkw\t1/m);
    const dsLine = lst.split("\n").find((l) => l.includes("GL_RND_SEED"));
    assert.ok(dsLine, "GL_RND_SEED 行がある");
    assert.ok(
      !/^0008 [0-9A-F]{4}/.test(dsLine!),
      `.ds 行にオペコードが出てはいけない: ${dsLine}`,
    );
  });

  test("TMS9995 の LST でも .ds / .blkw にバイトアドレスが出る", () => {
    const lst = writeLst(
      assemble(
        `
	.area	_WORK
	.org	0x8300
A:	.blkw	1
B:	.ds	2
`,
        "tms9995",
      ),
    );
    assert.match(lst, /^8300\s+A:\t\.blkw\t1/m);
    assert.match(lst, /^8302\s+B:\t\.ds\t2/m);
  });
});

// ─── INCLUDE ──────────────────────────────────────────────────────────────────

describe("INCLUDE: ファイルインクルード展開", () => {
  test("単一ファイルのインクルードが展開される", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn1610-test-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "main.asm"),
        '        .org 0\n        INCLUDE "helper.asm"\n        H\n',
      );
      fs.writeFileSync(path.join(tmpDir, "helper.asm"), "DATA:   .word 0xFF\n");

      const expanded = expandIncludesFromFile(path.join(tmpDir, "main.asm"));

      // INCLUDE ディレクティブが展開されてヘルパーの内容が現れる
      assert.ok(
        expanded.includes("DATA:   .word 0xFF"),
        `helper content missing:\n${expanded}`,
      );
      // INCLUDE 行自体は消える
      assert.ok(
        !expanded.includes('INCLUDE "helper.asm"'),
        `INCLUDE directive should be replaced:\n${expanded}`,
      );

      // アセンブルできることを確認
      const result = assemble(expanded);
      assert.ok(result.symbols.has("DATA"), "DATA label should be defined");
      assert.equal(result.symbols.get("DATA"), 0); // .org 0 の先頭
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("ネストされたインクルードが全て展開される", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn1610-test-"));
    try {
      // main → middle → inner の3段階ネスト
      fs.writeFileSync(
        path.join(tmpDir, "main.asm"),
        '        .org 0\n        INCLUDE "middle.asm"\n        H\n',
      );
      fs.writeFileSync(
        path.join(tmpDir, "middle.asm"),
        '        INCLUDE "inner.asm"\n        MVI R0, #5\n',
      );
      fs.writeFileSync(path.join(tmpDir, "inner.asm"), "BASE:   .word 0\n");

      const expanded = expandIncludesFromFile(path.join(tmpDir, "main.asm"));

      assert.ok(
        expanded.includes("BASE:   .word 0"),
        `inner content missing:\n${expanded}`,
      );
      assert.ok(
        expanded.includes("MVI R0, #5"),
        `middle content missing:\n${expanded}`,
      );
      assert.ok(
        !expanded.includes("INCLUDE"),
        "all INCLUDE directives should be replaced",
      );

      // アセンブルできることを確認
      const result = assemble(expanded);
      assert.ok(result.symbols.has("BASE"), "BASE label should be defined");
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test("インクルードしたファイルのシンボルが正しく解決される", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mn1610-test-"));
    try {
      // main.asm: IO_ADDR を定義したファイルを include してそのシンボルで RD 命令を発行
      fs.writeFileSync(
        path.join(tmpDir, "main.asm"),
        '        .org 0\n        INCLUDE "defs.asm"\n        RD R0, IO_ADDR\n        H\n',
      );
      fs.writeFileSync(path.join(tmpDir, "defs.asm"), "IO_ADDR .equ 7\n"); // SDAS流（コロンなし）

      const expanded = expandIncludesFromFile(path.join(tmpDir, "main.asm"));
      const result = assemble(expanded);

      // IO_ADDR = 7 として RD R0, 7 = 00011 000 00000111 = 0x1807
      const rdWord = result.words.find((w) => w.address === 0);
      assert.ok(rdWord, "RD instruction not found");
      assert.equal(
        rdWord.value,
        0x1807,
        `RD R0, 7 should be 0x1807, got 0x${rdWord.value.toString(16).toUpperCase()}`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe("assembler: .equ 形式", () => {
  test(".equ NAME, value", () => {
    const r = assemble(
      "        .equ IO_ADDR, 7\n        .org 0\n        RD R0, IO_ADDR\n",
    );
    assert.equal(r.symbols.get("IO_ADDR"), 7);
    assert.equal(r.words[0].value, 0x1807);
  });

  test("NAME: .equ value", () => {
    const r = assemble(
      "IO_ADDR: .equ 7\n        .org 0\n        RD R0, IO_ADDR\n",
    );
    assert.equal(r.symbols.get("IO_ADDR"), 7);
    assert.equal(r.words[0].value, 0x1807);
  });

  test("NAME .equ value（SDAS流・コロンなし）", () => {
    const r = assemble(
      "IO_ADDR .equ 7\n        .org 0\n        RD R0, IO_ADDR\n",
    );
    assert.equal(r.symbols.get("IO_ADDR"), 7);
    assert.equal(r.words[0].value, 0x1807);
  });

  test("NAME equ value（ドットなし EQU）", () => {
    const r = assemble(
      "IO_ADDR equ 7\n        .org 0\n        RD R0, IO_ADDR\n",
    );
    assert.equal(r.symbols.get("IO_ADDR"), 7);
    assert.equal(r.words[0].value, 0x1807);
  });

  test("NAME .equ 式", () => {
    const r = assemble(
      "BASE .equ 0x10\nSIZE .equ BASE + 2\n        .org 0\n        RD R0, SIZE\n",
    );
    assert.equal(r.symbols.get("BASE"), 0x10);
    assert.equal(r.symbols.get("SIZE"), 0x12);
    assert.equal(r.words[0].value, 0x1812);
  });

  test("NAME .equ 16進サフィックス / ビット演算", () => {
    const r = assemble(
      "MASK .equ 0FFH\nFLAG .equ MASK & 0x0F\n        .org 0\n        .word FLAG\n",
    );
    assert.equal(r.symbols.get("MASK"), 0xff);
    assert.equal(r.symbols.get("FLAG"), 0x0f);
    assert.equal(r.words[0].value, 0x000f);
  });

  test("NAME .equ コメント付き", () => {
    const r = assemble(
      "IO_ADDR .equ 7 ; handshake data port\n        .org 0\n        RD R0, IO_ADDR\n",
    );
    assert.equal(r.symbols.get("IO_ADDR"), 7);
    assert.equal(r.words[0].value, 0x1807);
  });

  test("前方参照の .equ（後で定義されるラベル差）", () => {
    const r = assemble(`
        .org 0
START:  H
        H
END:    H
SIZE    .equ END - START
        .word SIZE
`);
    assert.equal(r.symbols.get("SIZE"), 2);
    assert.equal(r.words[3].value, 2);
  });

  test(".word に NAME .equ 定数を埋め込む", () => {
    const r = assemble("VAL .equ 0x1234\n        .org 0\n        .word VAL\n");
    assert.equal(r.symbols.get("VAL"), 0x1234);
    assert.equal(r.words[0].value, 0x1234);
  });
});

describe("assembler: .area / .ds", () => {
  test(".area _CODE のあと .org するとその領域の PC になる", () => {
    const r = assemble(`
	.area	_CODE		(REL,CON)
	.org	0x0200
START:	H
`);
    assert.equal(r.symbols.get("START"), 0x0200);
    assert.equal(r.words[0]!.address, 0x0200);
    assert.equal(r.words[0]!.value, 0x2000);
  });

  test(".area _WORK の .ds はラベルだけ確保しワードを出さない", () => {
    const r = assemble(`
	.area	_WORK		(REL,NOLOAD)
	.org	0x1700
VAR:	.ds	1
BUF:	.ds	6
	.area	_CODE
	.org	0x0200
	H
`);
    assert.equal(r.symbols.get("VAR"), 0x1700);
    assert.equal(r.symbols.get("BUF"), 0x1701);
    assert.equal(r.words.length, 1);
    assert.equal(r.words[0]!.address, 0x0200);
  });

  test(".area _DATA の .word は ROM としてイメージに出す", () => {
    const r = assemble(`
	.area	_DATA		(REL,CON)
	.org	0x1600
TBL:	.word	0x1234
`);
    assert.equal(r.symbols.get("TBL"), 0x1600);
    assert.equal(r.words.length, 1);
    assert.equal(r.words[0]!.address, 0x1600);
    assert.equal(r.words[0]!.value, 0x1234);
  });

  test(".area を往復しても各領域の PC を保持する", () => {
    const r = assemble(`
	.area	_CODE
	.org	0x0200
A:	H
	.area	_WORK
	.org	0x1700
X:	.ds	1
	.area	_CODE
B:	H
	.area	_WORK
Y:	.ds	1
`);
    assert.equal(r.symbols.get("A"), 0x0200);
    assert.equal(r.symbols.get("B"), 0x0201);
    assert.equal(r.symbols.get("X"), 0x1700);
    assert.equal(r.symbols.get("Y"), 0x1701);
    assert.equal(r.words.length, 2);
  });

  test(".blkw は .ds と同じく予約する", () => {
    const r = assemble(`
	.area	_WORK
	.org	0x1700
A:	.blkw	2
B:	.ds	1
`);
    assert.equal(r.symbols.get("A"), 0x1700);
    assert.equal(r.symbols.get("B"), 0x1702);
    assert.equal(r.words.length, 0);
  });

  test("TMS9995 の .blkw はワード単位（バイト×2）", () => {
    const r = assemble(
      `
	.area	_WORK
	.org	0x8300
A:	.blkw	1
B:	.ds	2
`,
      "tms9995",
    );
    assert.equal(r.symbols.get("A"), 0x8300);
    assert.equal(r.symbols.get("B"), 0x8302);
    assert.equal(r.words.length, 0);
  });

  test("領域なしの .org 0 は従来どおり", () => {
    const r = assemble(`
        .org 0
START:  H
`);
    assert.equal(r.symbols.get("START"), 0);
    assert.equal(r.words[0]!.address, 0);
  });
});
