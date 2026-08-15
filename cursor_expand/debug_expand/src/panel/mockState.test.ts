/**
 * モック状態の最低限チェック
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createMockDebugState, memFetchRange, memNeedsRefetch, memNextCenter } from "./mockState";
import { getDebugHtml } from "./getHtml";

describe("createMockDebugState", () => {
  test("比較器スロットは 8（0–7）でダンプアドレスは 5 桁", () => {
    const s = createMockDebugState();
    assert.equal(s.bpSlots.length, 8);
    assert.equal(s.slotHistory.length, 8);
    assert.equal(s.current.stack.length, 16);
    assert.ok(s.disasm.length > 0);
    assert.ok(s.memDump.length > 0);
    assert.match(s.memDump[0]!.addr, /^[0-9A-F]{5}$/);
    assert.equal(s.memDump[0]!.words.length, 16);
    assert.equal(s.memDump[0]!.addr, "00000");
    assert.equal(s.memStart, 0x0108);
    assert.equal(s.memDump[0]!.words[0], "0000");
    assert.ok(s.memDump.length >= 0x800 / 16);
  });
});

describe("memFetchRange", () => {
  test("中心の ±800h を 16 ワード境界に揃える", () => {
    const w = memFetchRange(0x1800);
    assert.equal(w.lo, 0x1000);
    assert.ok(w.hi >= 0x2000);
    assert.equal(w.wordCount % 16, 0);
  });

  test("先頭付近は 0 から取る", () => {
    const w = memFetchRange(0x10);
    assert.equal(w.lo, 0);
  });
});

describe("memNeedsRefetch", () => {
  test("キャッシュ中央では再取得しない", () => {
    assert.equal(memNeedsRefetch(0x1800, 0x1900, 0x1000, 0x2000), false);
  });

  test("下端に近づくと再取得する", () => {
    assert.equal(memNeedsRefetch(0x1f80, 0x1fff, 0x1000, 0x2000), true);
  });
});

describe("memNextCenter", () => {
  test("下端では可視末尾を中心にする（0 始まり窓が 0900h で止まらない）", () => {
    const c = memNextCenter(0x0870, 0x090f, 0, 0x090f);
    assert.equal(c, 0x090f);
    const w = memFetchRange(c!);
    assert.ok(w.hi > 0x090f);
  });

  test("上端では可視先頭を中心にする", () => {
    assert.equal(memNextCenter(0x1008, 0x1080, 0x1000, 0x2000), 0x1008);
  });

  test("中央では null", () => {
    assert.equal(memNextCenter(0x1800, 0x1900, 0x1000, 0x2000), null);
  });
});

describe("getDebugHtml", () => {
  test("レイアウト領域の id を含む", () => {
    const html = getDebugHtml(
      "testnonce",
      "https://example.vscode-cdn.net",
      "https://example/debug.css",
      "https://example/debug.js",
      createMockDebugState(),
    );
    for (const id of [
      "regTabs",
      "disasm",
      "source",
      "bpSlots",
      "breakInfo",
      "memDump",
      "stackDump",
      "memMenu",
      "memGoto",
      "memNote",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /nonce-testnonce/);
  });
});
