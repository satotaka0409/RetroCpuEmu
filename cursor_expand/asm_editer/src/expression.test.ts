/**
 * .equ ホバー用式評価・構文認識のテスト
 *
 * 実行: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { tryEvalExpr } from "./expression";
import {
  collectEquDefs,
  isEquDefinitionLine,
  matchEquDef,
} from "./symbols/equParse";
import { parseAsmLine } from "./symbols/parseLine";
import {
  collectSymbolOccurrences,
  findIdentRangesInLine,
} from "./symbols/occurrences";
import {
  mn1610Architecture,
  mn1613Architecture,
} from "./cpu/mn1613/arch";
import { tms9995Architecture } from "./cpu/tms9995/arch";
import {
  detectArchitecture,
  setPreferredCpuId,
} from "./cpu/registry";

describe("tryEvalExpr（.equ ホバー用）", () => {
  const empty = new Map<string, number>();

  test("10進・16進リテラル", () => {
    assert.equal(tryEvalExpr("7", empty), 7);
    assert.equal(tryEvalExpr("0x10", empty), 0x10);
    assert.equal(tryEvalExpr("0FFH", empty), 0xff);
  });

  test("演算", () => {
    assert.equal(tryEvalExpr("1 + 2 * 3", empty), 7);
    assert.equal(tryEvalExpr("(1 + 2) * 3", empty), 9);
    assert.equal(tryEvalExpr("1 << 4", empty), 16);
    assert.equal(tryEvalExpr("0xFF & 0x0F", empty), 0x0f);
  });

  test("シンボル参照", () => {
    const sym = new Map<string, number>([
      ["BASE", 0x10],
      ["SIZE", 2],
    ]);
    assert.equal(tryEvalExpr("BASE + SIZE", sym), 0x12);
    assert.equal(tryEvalExpr("base + size", sym), 0x12);
  });

  test("未定義シンボルは undefined", () => {
    assert.equal(tryEvalExpr("UNDEF", empty), undefined);
    assert.equal(tryEvalExpr("1 + UNDEF", empty), undefined);
  });
});

describe("collectEquDefs / .equ NAME, value", () => {
  test("3形式をすべて拾う", () => {
    const text = `
.equ A, 1
B: .equ 2
C .equ 3
D equ 4 ; comment
LABEL:
        H
`;
    const defs = collectEquDefs(text);
    const map = new Map(defs.map((d) => [d.name, d.expr]));
    assert.equal(map.get("A"), "1");
    assert.equal(map.get("B"), "2");
    assert.equal(map.get("C"), "3");
    assert.equal(map.get("D"), "4");
    assert.equal(defs.length, 4);
  });

  test(".equ NAME , value（カンマ前後スペース）", () => {
    const m = matchEquDef(".equ INTERRUPT_BUSY , 0x20");
    assert.deepEqual(m, { name: "INTERRUPT_BUSY", expr: "0x20" });
  });

  test(".equ NAME value（カンマなし）", () => {
    const m = matchEquDef(".equ PORT 7");
    assert.deepEqual(m, { name: "PORT", expr: "7" });
  });

  test("タブ区切り .equ NAME, value", () => {
    const m = matchEquDef(".equ\tHSHK_ACK,\t0x22");
    assert.deepEqual(m, { name: "HSHK_ACK", expr: "0x22" });
  });

  test("式付き SDAS 流", () => {
    const defs = collectEquDefs("BASE .equ 0x10\nSIZE .equ BASE + 2\n");
    assert.equal(defs[0]!.name, "BASE");
    assert.equal(defs[0]!.expr, "0x10");
    assert.equal(defs[1]!.name, "SIZE");
    assert.equal(defs[1]!.expr, "BASE + 2");
  });

  test("収集した式を tryEvalExpr で解決", () => {
    const defs = collectEquDefs("BASE .equ 0x10\nSIZE .equ BASE + 2\n");
    const values = new Map<string, number>();
    for (let pass = 0; pass < 4; pass += 1) {
      for (const d of defs) {
        if (values.has(d.name)) continue;
        const v = tryEvalExpr(d.expr, values);
        if (v !== undefined) values.set(d.name, v);
      }
    }
    assert.equal(values.get("BASE"), 0x10);
    assert.equal(values.get("SIZE"), 0x12);
  });
});

describe("parseAsmLine: .equ は未知命令にしない", () => {
  const arch = mn1613Architecture;

  const equLines = [
    ".equ INTERRUPT_BUSY, 0x20",
    ".equ INTERRUPT_BUSY , 0x20",
    ".equ\tHSHK_ACK,\t0x22",
    "INTERRUPT_BUSY .equ 0x20",
    "INTERRUPT_BUSY\t.equ\t0x20",
    "PORT: .equ 7",
    "PORT equ 7",
  ];

  for (const line of equLines) {
    test(`directive: ${JSON.stringify(line)}`, () => {
      assert.equal(isEquDefinitionLine(line), true);
      const p = parseAsmLine(line, arch);
      assert.equal(p.kind, "directive");
      assert.notEqual(p.kind, "unknown");
    });
  }

  test("通常の未知命令は unknown のまま", () => {
    const p = parseAsmLine("        FOOBAR R0, 1", arch);
    assert.equal(p.kind, "unknown");
    assert.equal(p.mnemonic, "FOOBAR");
  });

  test("LABEL: .ds n はディレクティブ（未知命令にしない）", () => {
    const p = parseAsmLine("GL_HSHK_RECV_DATA:\t.ds\t1\t; 受信 1 バイト", arch);
    assert.equal(p.kind, "directive");
    assert.equal(p.mnemonic?.replace(/^\./, ""), "DS");
  });

  test(".blkw もディレクティブ", () => {
    const p = parseAsmLine("BUF:\t.blkw\t6", arch);
    assert.equal(p.kind, "directive");
    assert.equal(p.mnemonic?.replace(/^\./, ""), "BLKW");
  });

  test("一覧に無い .foo も未知命令にしない", () => {
    const p = parseAsmLine("\t.foo\t1", arch);
    assert.equal(p.kind, "directive");
  });
});

describe("parseAsmLine: ラベル参照抽出", () => {
  const arch = mn1613Architecture;

  test(".dw 未定義ラベルを refs に含める", () => {
    const p = parseAsmLine("\t.dw\ttimer1_interrupt_handler", arch);
    assert.equal(p.kind, "directive");
    assert.deepEqual(p.refs, ["TIMER1_INTERRUPT_HANDLER"]);
  });

  test("B 未定義ラベルを refs に含める", () => {
    const p = parseAsmLine("\tb\tmissing_label", arch);
    assert.equal(p.kind, "instruction");
    assert.deepEqual(p.refs, ["MISSING_LABEL"]);
  });

  test("式 LABEL+2 から識別子を拾う", () => {
    const p = parseAsmLine("\tb\tUNDEF+2", arch);
    assert.equal(p.kind, "instruction");
    assert.deepEqual(p.refs, ["UNDEF"]);
  });

  test("インデックス LABEL(R1) から識別子を拾う", () => {
    const p = parseAsmLine("\tl\tR0, LAB(R1)", arch);
    assert.equal(p.kind, "instruction");
    assert.deepEqual(p.refs, ["LAB"]);
  });

  test(".include の文字列は refs にしない", () => {
    const p = parseAsmLine('\t.include "interrupt_io.inc"', arch);
    assert.equal(p.kind, "directive");
    assert.deepEqual(p.refs, []);
  });

  test("定数 0 だけの .dw は refs 空", () => {
    const p = parseAsmLine("\t.dw\t0", arch);
    assert.equal(p.kind, "directive");
    assert.deepEqual(p.refs, []);
  });

  test("0b 二進リテラルは未定義ラベルにしない", () => {
    const p = parseAsmLine("\tandi\tR0, 0b00000111", arch);
    assert.equal(p.kind, "instruction");
    assert.deepEqual(p.refs, []);
  });

  test(".dw 0b11100000 / #0b / #0x も refs 空", () => {
    const dw = parseAsmLine("\t.dw\t0b11100000\t\t; STR", arch);
    assert.equal(dw.kind, "directive");
    assert.deepEqual(dw.refs, []);
    assert.deepEqual(parseAsmLine("\tmvi\tR0, #0b11100000", arch).refs, []);
    assert.deepEqual(parseAsmLine("\tandi\tR0, #0xFFFF", arch).refs, []);
  });

  test("0b11100000 内の B11100000 は単語として見つからない", () => {
    assert.deepEqual(
      findIdentRangesInLine("\t.dw\t0b11100000", "B11100000"),
      [],
    );
    assert.deepEqual(findIdentRangesInLine("\tandi\tR0, #0xFFFF", "XFFFF"), []);
  });

  test("0x / サフィックス数値も refs にしない", () => {
    const p = parseAsmLine("\tandi\tR0, 0x07", arch);
    assert.deepEqual(p.refs, []);
    const p2 = parseAsmLine("\tmvi\tR0, 1010b", arch);
    assert.deepEqual(p2.refs, []);
    const p3 = parseAsmLine("\tmvi\tR0, 0FFh", arch);
    assert.deepEqual(p3.refs, []);
  });

  test("数値とラベル混在ではラベルだけ拾う", () => {
    const p = parseAsmLine("\tai\tR0, MASK+0b11", arch);
    assert.deepEqual(p.refs, ["MASK"]);
  });

  test("HSHK_DELAY_50US を数値リテラルとして壊さない", () => {
    const p = parseAsmLine("\tawi\tR0, HSHK_DELAY_50US", arch);
    assert.deepEqual(p.refs, ["HSHK_DELAY_50US"]);
  });
});

describe("collectSymbolOccurrences", () => {
  const arch = mn1613Architecture;

  test("定義と参照を集める", () => {
    const text = [
      "gl_handshake_interrupt_handler:",
      "\tret",
      "\t.dw\tgl_handshake_interrupt_handler",
      "\tb\tgl_handshake_interrupt_handler",
    ].join("\n");
    const occs = collectSymbolOccurrences(
      text,
      "gl_handshake_interrupt_handler",
      arch,
      true,
    );
    assert.equal(occs.filter((o) => o.kind === "declaration").length, 1);
    assert.equal(occs.filter((o) => o.kind === "reference").length, 2);
  });

  test("includeDeclaration=false では定義を除外", () => {
    const text = "FOO:\n\tb\tFOO\n";
    const occs = collectSymbolOccurrences(text, "FOO", arch, false);
    assert.deepEqual(
      occs.map((o) => o.kind),
      ["reference"],
    );
  });

  test("FOO と FOOBAR を混同しない", () => {
    assert.deepEqual(findIdentRangesInLine("\tb\tFOOBAR", "FOO"), []);
    assert.deepEqual(findIdentRangesInLine("\tb\tFOO", "FOO"), [
      { start: 3, end: 6 },
    ]);
  });
});

describe("collectIncludePaths", () => {
  test(".include パスを集める", () => {
    const { collectIncludePaths } = require("./symbols/includeParse") as {
      collectIncludePaths: (t: string) => string[];
    };
    const paths = collectIncludePaths(
      '; c\n.include "../handshake_io.inc"\nINCLUDE "a.inc"\n',
    );
    assert.deepEqual(paths, ['"../handshake_io.inc"', '"a.inc"']);
  });
});

describe("detectArchitecture / preferred CPU", () => {
  test(".mn1610 / .mn1613 / .tms9995 は拡張子優先", () => {
    setPreferredCpuId("mn1613");
    assert.equal(detectArchitecture("x.mn1610").id, "mn1610");
    setPreferredCpuId("mn1610");
    assert.equal(detectArchitecture("x.mn1613").id, "mn1613");
    setPreferredCpuId("mn1613");
    assert.equal(detectArchitecture("x.tms9995").id, "tms9995");
  });

  test(".asm はステータスバー選択に従う", () => {
    setPreferredCpuId("mn1610");
    assert.equal(detectArchitecture("foo.asm").id, "mn1610");
    setPreferredCpuId("mn1613");
    assert.equal(detectArchitecture("foo.asm").id, "mn1613");
    setPreferredCpuId("tms9995");
    assert.equal(detectArchitecture("foo.asm").id, "tms9995");
  });

  test("MN1610 モードでは AWI を未知命令にする", () => {
    const p10 = parseAsmLine("\tawi\tR0, 1", mn1610Architecture);
    assert.equal(p10.kind, "unknown");
    const p13 = parseAsmLine("\tawi\tR0, 1", mn1613Architecture);
    assert.equal(p13.kind, "instruction");
  });

  test("TMS9995 モードでは LI / MOV を命令、AWI を未知にする", () => {
    const li = parseAsmLine("\tLI\tR1, >1234", tms9995Architecture);
    assert.equal(li.kind, "instruction");
    assert.equal(li.mnemonic, "LI");
    const mov = parseAsmLine("\tMOV\tR1, R2", tms9995Architecture);
    assert.equal(mov.kind, "instruction");
    const awi = parseAsmLine("\tawi\tR0, 1", tms9995Architecture);
    assert.equal(awi.kind, "unknown");
  });
});
