/**
 * 未使用グローバル宣言の警告テスト。
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mn1613Architecture } from "../cpu/mn1613/arch";
import { collectOperandRefCounts } from "../symbols/occurrences";
import { findUnusedGlobalDeclarations } from "./unusedGlobals";

describe("findUnusedGlobalDeclarations", () => {
  const arch = mn1613Architecture;

  /**
   * @param line ソース行
   * @param used 参照済みとみなす名前
   * @returns メッセージ
   */
  function msgs(line: string, used: string[]): string[] {
    const set = new Set(used.map((n) => n.toUpperCase()));
    return findUnusedGlobalDeclarations(line, arch, (n) => set.has(n)).map(
      (h) => h.message,
    );
  }

  test("参照があれば警告しない", () => {
    assert.deepEqual(msgs("        .global g_foo", ["G_FOO"]), []);
  });

  test("参照が無ければ警告する", () => {
    const m = msgs("        .global g_foo", []);
    assert.equal(m.length, 1);
    assert.match(m[0]!, /g_foo/i);
  });

  test("複数名は未参照だけ警告する", () => {
    const m = msgs("        .globl A, B, C", ["B"]);
    assert.equal(m.length, 2);
    assert.ok(m.some((x) => /: A$/.test(x)));
    assert.ok(m.some((x) => /: C$/.test(x)));
  });
});

describe("collectOperandRefCounts", () => {
  const arch = mn1613Architecture;

  test(".global とラベル定義は参照に数えない", () => {
    const src = [
      "        .global FOO",
      "FOO:",
      "        H",
      "",
    ].join("\n");
    const c = collectOperandRefCounts(src, arch);
    assert.equal(c.get("FOO") ?? 0, 0);
  });

  test("命令オペランドは参照に数える", () => {
    const src = [
      "        .global FOO",
      "FOO:",
      "        B FOO",
      "",
    ].join("\n");
    const c = collectOperandRefCounts(src, arch);
    assert.equal(c.get("FOO"), 1);
  });

  test(".word のラベルは参照に数える", () => {
    const src = "        .word g_main\n";
    const c = collectOperandRefCounts(src, arch);
    assert.equal(c.get("G_MAIN"), 1);
  });
});
