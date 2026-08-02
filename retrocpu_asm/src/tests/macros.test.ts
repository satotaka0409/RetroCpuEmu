/**
 * マクロ／リピート展開テスト（ASxxxx / sdas 準拠）
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assemble } from "../main/assembler";
import { expandMacros, extractMacros } from "../main/macros";

describe("マクロ: 基本", () => {
  test(".macro / .endm で定義し、引数付きで呼び出せる", () => {
    const src = `
        .org 0
        .macro LOADIMM, reg, val
                MVI reg, #val
        .endm
                LOADIMM R0, 0x55
                H
`;
    const r = assemble(src);
    assert.equal(r.words[0]?.value, 0x0855);
    assert.equal(r.words[1]?.value, 0x2000);
  });

  test("仮引数が複数あっても置換される", () => {
    const src = `
        .org 0
        .macro ADD2, dst, src
                A dst, src
        .endm
                MVI R0, #1
                MVI R1, #2
                ADD2 R0, R1
                H
`;
    const r = assemble(src);
    assert.ok(
      r.words.some((w) => (w.value & 0xf800) === 0x5800),
      `expected A instruction in ${r.words.map((w) => w.value.toString(16))}`,
    );
  });

  test("マクロ内の ? は展開ごとに一意になる", () => {
    const expanded = expandMacros(`
        .macro TWICE
        L?:   .word 1
        .endm
                TWICE
                TWICE
`);
    assert.match(expanded, /LM1:/);
    assert.match(expanded, /LM2:/);
  });

  test("ネストしたマクロ呼び出しを展開できる", () => {
    const src = `
        .org 0
        .macro INNER, r
                MVI r, #7
        .endm
        .macro OUTER, r
                INNER r
        .endm
                OUTER R2
                H
`;
    const r = assemble(src);
    assert.equal(r.words[0]?.value, 0x0a07);
  });

  test("呼び出し行のラベルが先頭に残る", () => {
    const expanded = expandMacros(`
        .macro NOPISH
                MV R0, R0
        .endm
        START:  NOPISH
`);
    assert.match(expanded, /START:/);
    assert.match(expanded, /MV\s+R0,\s*R0/i);
  });

  test("定義はソースから取り除かれる", () => {
    const { sourceWithoutDefs, macros } = extractMacros(`
        .macro FOO, x
                MVI R0, #x
        .endm
                FOO 1
`);
    assert.equal(macros.size, 1);
    assert.ok(!/\.macro/i.test(sourceWithoutDefs));
    assert.ok(!/\.endm/i.test(sourceWithoutDefs));
  });
});

describe("マクロ: .mexit / ネスト定義", () => {
  test(".mexit でマクロ展開を途中終了できる", () => {
    const expanded = expandMacros(`
        .macro PARTIAL
                MVI R0, #1
                .mexit
                MVI R0, #2
        .endm
                PARTIAL
`);
    assert.match(expanded, /MVI\s+R0,\s*#1/i);
    assert.ok(!/#2/.test(expanded), expanded);
  });

  test("マクロ内で別マクロを定義できる（ネスト定義）", () => {
    const src = `
        .org 0
        .macro DEFINE_FOO
        .macro FOO
                MVI R0, #9
        .endm
        .endm
                DEFINE_FOO
                FOO
                H
`;
    const r = assemble(src);
    assert.equal(r.words[0]?.value, 0x0809);
  });
});

describe("マクロ: .rept / .irp / .irpc", () => {
  test(".rept でブロックを繰り返す", () => {
    const src = `
        .org 0
        .rept 3
                .word 0xAA
        .endm
                H
`;
    const r = assemble(src);
    assert.equal(r.words.length, 4);
    assert.equal(r.words[0]?.value, 0x00aa);
    assert.equal(r.words[1]?.value, 0x00aa);
    assert.equal(r.words[2]?.value, 0x00aa);
    assert.equal(r.words[3]?.value, 0x2000);
  });

  test(".irp で引数リストを順に展開する", () => {
    const src = `
        .org 0
        .irp reg, R0, R1, R2
                MVI reg, #0
        .endm
                H
`;
    const r = assemble(src);
    assert.equal(r.words[0]?.value, 0x0800); // MVI R0, #0
    assert.equal(r.words[1]?.value, 0x0900); // MVI R1, #0
    assert.equal(r.words[2]?.value, 0x0a00); // MVI R2, #0
  });

  test(".irpc で文字ごとに展開する", () => {
    const expanded = expandMacros(`
        .irpc c, AB
                .word c
        .endm
`);
    // 置換後は .word A / .word B （シンボルとして残る）
    assert.match(expanded, /\.word\s+A/);
    assert.match(expanded, /\.word\s+B/);
  });

  test(".rept 内の .mexit で繰り返しを打ち切れる", () => {
    const expanded = expandMacros(`
        .rept 5
                MVI R0, #1
                .mexit
                MVI R0, #2
        .endm
`);
    // 各繰り返しで .mexit まで → #1 が5回、#2 は出ない
    const ones = expanded.match(/#1/g) ?? [];
    assert.equal(ones.length, 5);
    assert.ok(!/#2/.test(expanded));
  });
});

describe("マクロ: エラー", () => {
  test("閉じない .macro はエラー", () => {
    assert.throws(
      () => expandMacros(".macro FOO\n MVI R0, #1\n"),
      /Unclosed block/i,
    );
  });

  test(".endm だけのときはエラー", () => {
    assert.throws(
      () => expandMacros(".endm\n"),
      /\.endm without matching block/i,
    );
  });

  test("重複定義はエラー", () => {
    assert.throws(
      () =>
        expandMacros(`
        .macro FOO
        .endm
        .macro FOO
        .endm
`),
      /Duplicate macro/i,
    );
  });

  test("引数過多はエラー", () => {
    assert.throws(
      () =>
        expandMacros(`
        .macro FOO, a
                MVI R0, #a
        .endm
                FOO 1, 2
`),
      /expects at most/i,
    );
  });
});
