/**
 * ラベル直前コメント / JSDoc 風ホバー
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatSubroutineDocMarkdown,
  parseSubroutineDocAbove,
  pickDeclarationDoc,
} from "./jsdoc";

describe("parseSubroutineDocAbove", () => {
  test("JSDoc 風タグを構造化する", () => {
    const lines = [
      "; コピーする",
      "; @param R0 - 元",
      "; @return なし",
      "; @Destruction R1",
      "g_mem_cpy:",
    ];
    const doc = parseSubroutineDocAbove(lines, 4);
    assert.ok(doc);
    assert.equal(doc.jsdoc, true);
    assert.equal(doc.brief, "コピーする");
    assert.deepEqual(doc.params, [{ name: "R0", description: "元" }]);
    assert.equal(doc.returns, "なし");
    assert.deepEqual(doc.clobbers, ["R1"]);
  });

  test("タグが無い宣言コメントも返す", () => {
    const lines = ["; 作業用バッファ", "; 次の行", "GL_BUF:"];
    const doc = parseSubroutineDocAbove(lines, 2);
    assert.ok(doc);
    assert.equal(doc.jsdoc, false);
    assert.equal(doc.brief, "作業用バッファ\n次の行");
  });
});

describe("formatSubroutineDocMarkdown", () => {
  test("JSDoc はタグ表で強調する", () => {
    const md = formatSubroutineDocMarkdown(
      {
        brief: "コピーする",
        params: [{ name: "R0", description: "元" }],
        returns: "なし",
        clobbers: ["R1"],
        raw: "",
        jsdoc: true,
      },
      "G_MEM_CPY",
    );
    assert.match(md, /`@param`/);
    assert.match(md, /\*\*`R0`\*\*/);
    assert.match(md, /`@return`/);
    assert.match(md, /`@Destruction`/);
  });

  test("通常コメントは本文だけ出す", () => {
    const md = formatSubroutineDocMarkdown(
      {
        brief: "作業用",
        params: [],
        clobbers: [],
        raw: "作業用",
        jsdoc: false,
      },
      "GL_BUF",
    );
    assert.match(md, /作業用/);
    assert.equal(md.includes("`@param`"), false);
  });
});

describe("pickDeclarationDoc", () => {
  test("ラベル定義のコメントを .global より優先する", () => {
    const doc = pickDeclarationDoc([
      { kind: "global", doc: { brief: "宣言", params: [], clobbers: [], raw: "", jsdoc: false } },
      { kind: "label", doc: { brief: "定義", params: [], clobbers: [], raw: "", jsdoc: false } },
    ]);
    assert.equal(doc?.brief, "定義");
  });
});
