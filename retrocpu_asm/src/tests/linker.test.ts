/**
 * MN1613 リンカ テスト
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { assemble } from "../main/assembler";
import { writeRel } from "../main/relWriter";
import { parseRel } from "../main/relParser";
import { linkRelTexts, linkModules } from "../main/linker";

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
    assert.equal(m.codeSize, 2);
    assert.equal(m.code.get(0), 0);
    assert.equal(m.code.get(1), 0);
    assert.ok(m.refs.has("END"));
    assert.ok(m.refs.has("START"));
    assert.equal(m.relocs.length, 1);
    assert.deepEqual(m.relocs[0], {
      byteAddr: 0,
      left: { kind: "symbol", name: "END" },
      right: { kind: "symbol", name: "START" },
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
    });
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
      {
        moduleName: "A",
        codeSize: 0,
        code: new Map(),
        defs: new Map([
          ["START", 0],
          ["END", 10],
        ]),
        refs: new Set(),
        relocs: [],
      },
      {
        moduleName: "B",
        codeSize: 2,
        code: new Map([
          [0, 0],
          [1, 0],
        ]),
        defs: new Map(),
        refs: new Set(["START", "END"]),
        relocs: [
          {
            byteAddr: 0,
            left: { kind: "symbol", name: "END" },
            right: { kind: "symbol", name: "START" },
          },
        ],
      },
    ]);
    assert.equal(result.image[0], 0x00);
    assert.equal(result.image[1], 0x05);
  });

  test("外部 - ローカルワード → ワード差", () => {
    const result = linkModules([
      {
        moduleName: "USE",
        codeSize: 2,
        code: new Map([
          [0, 0],
          [1, 0],
        ]),
        defs: new Map(),
        refs: new Set(["END"]),
        relocs: [
          {
            byteAddr: 0,
            left: { kind: "symbol", name: "END" },
            right: { kind: "word", value: 0 },
          },
        ],
      },
      {
        moduleName: "DEFS",
        codeSize: 6,
        code: new Map(),
        defs: new Map([["END", 6]]),
        refs: new Set(),
        relocs: [],
      },
    ]);
    // END abs byte = 2+6 = 8 → word 4; LOCAL word 0 → diff 4
    assert.equal(result.image[0], 0x00);
    assert.equal(result.image[1], 0x04);
  });
});
