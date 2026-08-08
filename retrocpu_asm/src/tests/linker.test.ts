/**
 * MN1613 リンカ テスト
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../main/assembler";
import { writeRel } from "../main/relWriter";
import { parseRel, type RelModule } from "../main/relParser";
import {
  linkRelTexts,
  linkModules,
  orderRelPathsMainFirst,
  orderModulesMainFirst,
} from "../main/linker";
import { orderLinkAreaNames } from "../main/areaOrder";
import { parseLinkArgs } from "../main/linkCli";
import type { WordDiffReloc } from "../main/types";

/**
 * テスト用に `_CODE` だけの RelModule を作る。
 * @param opts - モジュール名と _CODE 内容
 * @returns RelModule
 */
function codeMod(opts: {
  moduleName: string;
  codeSize?: number;
  code?: Map<number, number>;
  defs?: Map<string, number>;
  refs?: Set<string>;
  relocs?: WordDiffReloc[];
}): RelModule {
  const defs = new Map<string, { offset: number; area: string }>();
  for (const [name, offset] of opts.defs ?? []) {
    defs.set(name, { offset, area: "_CODE" });
  }
  return {
    moduleName: opts.moduleName,
    areas: [
      {
        name: "_CODE",
        size: opts.codeSize ?? 0,
        noload: false,
        code: opts.code ?? new Map(),
      },
    ],
    defs,
    refs: opts.refs ?? new Set(),
    relocs: (opts.relocs ?? []).map((r) => ({
      ...r,
      area: r.area ?? "_CODE",
    })),
  };
}

describe("parseRel", () => {
  test("Def / Ref / W / T を読み取れる", () => {
    const text = `\
XH2
H 0001 areas 0002 global symbols
M USE
A _CODE size 0002 flags 0000
T 0000 02 00 00
S END Ref0000
S START Ref0000
W 0000 END-START
E
`;
    const m = parseRel(text);
    assert.equal(m.moduleName, "USE");
    const code = m.areas.find((a) => a.name === "_CODE")!;
    assert.equal(code.size, 2);
    assert.equal(code.code.get(0), 0);
    assert.equal(code.code.get(1), 0);
    assert.ok(m.refs.has("END"));
    assert.ok(m.refs.has("START"));
    assert.equal(m.relocs.length, 1);
    assert.deepEqual(m.relocs[0], {
      byteAddr: 0,
      left: { kind: "symbol", name: "END" },
      right: { kind: "symbol", name: "START" },
      area: "_CODE",
    });
  });

  test("W の #ワード定数オペランドを読み取れる", () => {
    const text = `\
XH2
M USE
A _CODE size 0002 flags 0000
T 0000 02 00 00
S END Ref0000
W 0000 END-#0000
E
`;
    const m = parseRel(text);
    assert.deepEqual(m.relocs[0], {
      byteAddr: 0,
      left: { kind: "symbol", name: "END" },
      right: { kind: "word", value: 0 },
      area: "_CODE",
    });
  });
});

describe("orderLinkAreaNames: _CODE → _DATA → _WORK", () => {
  test("宣言順が逆でもリンク順は固定", () => {
    assert.deepEqual(orderLinkAreaNames(["_WORK", "_DATA", "_CODE", "_VECTOR"]), [
      "_VECTOR",
      "_CODE",
      "_DATA",
      "_WORK",
    ]);
  });
});

describe("orderRelPathsMainFirst: main.rel を先頭にする", () => {
  test("引数順に関係なく main.rel が先頭", () => {
    assert.deepEqual(
      orderRelPathsMainFirst(["interrupt.rel", "bios.rel", "main.rel"]),
      ["main.rel", "interrupt.rel", "bios.rel"],
    );
  });

  test("大文字小文字・パス付きでも main.rel とみなす", () => {
    assert.deepEqual(
      orderRelPathsMainFirst(["obj/INT.rel", "build/Main.REL"]),
      ["build/Main.REL", "obj/INT.rel"],
    );
  });

  test("main.rel が無いとエラー", () => {
    assert.throws(
      () => orderRelPathsMainFirst(["interrupt.rel", "bios.rel"]),
      /main\.rel must be linked first/i,
    );
  });

  test("main.rel が複数あるとエラー", () => {
    assert.throws(
      () => orderRelPathsMainFirst(["a/main.rel", "b/main.rel"]),
      /multiple main\.rel/i,
    );
  });
});

describe("parseLinkArgs: main.rel 必須の案内", () => {
  test("入力なしは Usage（main.rel 先頭の説明付き）", () => {
    assert.throws(() => parseLinkArgs([]), /main\.rel is required/i);
  });

  test("入力があれば順序はそのまま返し、並べ替えは orderRelPathsMainFirst", () => {
    const opts = parseLinkArgs(["interrupt.rel", "main.rel", "-o", "out.bin"]);
    assert.deepEqual(opts.inputs, ["interrupt.rel", "main.rel"]);
    assert.equal(opts.outBin, "out.bin");
    assert.equal(opts.outCdb, undefined);

    const withCdb = parseLinkArgs([
      "main.rel",
      "-o",
      "out.bin",
      "--cdb",
      "out.cdb",
    ]);
    assert.equal(withCdb.outCdb, "out.cdb");
    assert.deepEqual(orderRelPathsMainFirst(opts.inputs), [
      "main.rel",
      "interrupt.rel",
    ]);
  });
});

describe("orderModulesMainFirst / linkModules: MAIN を先頭にする", () => {
  test("モジュール名 MAIN は配列末尾でも先頭へ", () => {
    const ordered = orderModulesMainFirst([
      codeMod({ moduleName: "BIOS" }),
      codeMod({ moduleName: "MAIN" }),
    ]);
    assert.equal(ordered[0]!.moduleName, "MAIN");
    assert.equal(ordered[1]!.moduleName, "BIOS");
  });

  test("MAIN が後から渡されてもイメージ先頭は MAIN のコード", () => {
    const result = linkModules([
      codeMod({
        moduleName: "BIOS",
        codeSize: 2,
        code: new Map([
          [0, 0xaa],
          [1, 0xbb],
        ]),
      }),
      codeMod({
        moduleName: "MAIN",
        codeSize: 2,
        code: new Map([
          [0, 0x11],
          [1, 0x22],
        ]),
        defs: new Map([["GL_MAIN", 0]]),
      }),
    ]);
    assert.equal(result.image[0], 0x11);
    assert.equal(result.image[1], 0x22);
    assert.equal(result.image[2], 0xaa);
    assert.equal(result.image[3], 0xbb);
    assert.equal(result.defs.get("GL_MAIN"), 0);
  });

  test("MAIN が複数あるとエラー", () => {
    assert.throws(
      () =>
        linkModules([
          codeMod({ moduleName: "MAIN" }),
          codeMod({ moduleName: "main" }),
        ]),
      /Duplicate MAIN module/i,
    );
  });
});

describe("linkRelTexts: 外部グローバル差はワード数", () => {
  test("END-START → 3（バイト差 6 を ÷2）", () => {
    const defsRel = writeRel(
      assemble(`
        .org 0
        .globl START
        .globl END
START:  H
        H
        H
END:
`),
      "DEFS",
    );
    const useRel = writeRel(
      assemble(`
        .org 0
        .globl START
        .globl END
        .word END - START
`),
      "USE",
    );

    const linked = linkRelTexts([defsRel, useRel]);
    assert.equal(linked.defs.get("START"), 0);
    assert.equal(linked.defs.get("END"), 6);
    assert.equal(linked.image[6], 0x00);
    assert.equal(linked.image[7], 0x03);
  });

  test("未解決 Ref はエラー", () => {
    const useRel = writeRel(
      assemble(`
        .org 0
        .globl START
        .globl END
        .word END - START
`),
      "USE",
    );
    assert.throws(() => linkRelTexts([useRel]), /Unresolved/);
  });

  test("重複 Def はエラー", () => {
    const a = writeRel(
      assemble(`
        .org 0
        .globl START
START:  H
`),
      "A",
    );
    const b = writeRel(
      assemble(`
        .org 0
        .globl START
START:  H
`),
      "B",
    );
    assert.throws(() => linkRelTexts([a, b]), /Duplicate global/);
  });
});

describe("linkModules: W パッチ単体", () => {
  test("バイト差 10 → ワード差 5", () => {
    const result = linkModules([
      codeMod({
        moduleName: "A",
        defs: new Map([
          ["START", 0],
          ["END", 10],
        ]),
      }),
      codeMod({
        moduleName: "B",
        codeSize: 2,
        code: new Map([
          [0, 0],
          [1, 0],
        ]),
        refs: new Set(["START", "END"]),
        relocs: [
          {
            byteAddr: 0,
            left: { kind: "symbol", name: "END" },
            right: { kind: "symbol", name: "START" },
          },
        ],
      }),
    ]);
    assert.equal(result.image[0], 0x00);
    assert.equal(result.image[1], 0x05);
  });

  test("外部 - ローカルワード → ワード差", () => {
    const result = linkModules([
      codeMod({
        moduleName: "USE",
        codeSize: 2,
        code: new Map([
          [0, 0],
          [1, 0],
        ]),
        refs: new Set(["END"]),
        relocs: [
          {
            byteAddr: 0,
            left: { kind: "symbol", name: "END" },
            right: { kind: "word", value: 0 },
          },
        ],
      }),
      codeMod({
        moduleName: "DEFS",
        codeSize: 6,
        defs: new Map([["END", 6]]),
      }),
    ]);
    // END abs byte = 2+6 = 8 → word 4; LOCAL word 0 → diff 4
    assert.equal(result.image[0], 0x00);
    assert.equal(result.image[1], 0x04);
  });
});

describe("linkRelTexts: _CODE のあと _DATA", () => {
  test("全モジュールの _CODE を先に連結してから _DATA", () => {
    const mainRel = writeRel(
      assemble(`
	.area	_CODE		(REL,CON)
	.globl	GL_MAIN
GL_MAIN:
	H
	.area	_DATA		(REL,CON)
	.globl	TABLE
TABLE:
	.dw	0x1111
`),
      "MAIN",
    );
    const otherRel = writeRel(
      assemble(`
	.area	_WORK		(REL,NOLOAD)
BUF:	.ds	1
	.area	_DATA		(REL,CON)
	.globl	TABLE2
TABLE2:
	.dw	0x2222
	.area	_CODE		(REL,CON)
	H
`),
      "OTHER",
    );

    const aOrder = [...otherRel.matchAll(/^A\s+(\S+)/gm)].map((m) => m[1]);
    assert.deepEqual(aOrder, ["_CODE", "_DATA", "_WORK"]);

    const linked = linkRelTexts([otherRel, mainRel]);
    // MAIN _CODE (H=0x2000) then OTHER _CODE (H) then MAIN _DATA then OTHER _DATA
    assert.equal(linked.image[0], 0x20);
    assert.equal(linked.image[1], 0x00);
    assert.equal(linked.image[2], 0x20);
    assert.equal(linked.image[3], 0x00);
    assert.equal(linked.image[4], 0x11);
    assert.equal(linked.image[5], 0x11);
    assert.equal(linked.image[6], 0x22);
    assert.equal(linked.image[7], 0x22);
    assert.equal(linked.defs.get("GL_MAIN"), 0);
    assert.equal(linked.defs.get("TABLE"), 4);
    assert.equal(linked.defs.get("TABLE2"), 6);
    // _WORK は NOLOAD なのでイメージ末尾に出ない
    assert.equal(linked.image.length, 8);
  });

  test("_CODE から _DATA ラベル、_DATA から _CODE ラベルを絶対ワードにする", () => {
    const rel = writeRel(
      assemble(`
	.area	_CODE		(REL,CON)
	.globl	MAIN
MAIN:
	H
HANDLER:
	RET
	MVWI	R3, #TAB
	.area	_DATA		(REL,CON)
TAB:
	.dw	0
	.dw	HANDLER
`),
      "MAIN",
    );
    assert.match(rel, /#_DATA:0000/i);
    assert.match(rel, /#_CODE:0001/i);

    const linked = linkRelTexts([rel]);
    const codeWords = 4;
    const codeBytes = codeWords * 2;
    const tabWord = codeWords;
    const handlerWord = 1;
    const mvwiImmOff = 3 * 2;
    assert.equal(linked.image[mvwiImmOff], (tabWord >> 8) & 0xff);
    assert.equal(linked.image[mvwiImmOff + 1], tabWord & 0xff);
    const dwHandlerOff = codeBytes + 2;
    assert.equal(linked.image[dwHandlerOff], (handlerWord >> 8) & 0xff);
    assert.equal(linked.image[dwHandlerOff + 1], handlerWord & 0xff);
  });
});
