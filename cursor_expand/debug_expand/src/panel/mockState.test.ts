/**
 * モック状態の最低限チェック
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createMockDebugState } from "./mockState";
import { getDebugHtml } from "./getHtml";

describe("createMockDebugState", () => {
  test("比較器スロットは命令／アドレスとも 8（0–7）", () => {
    const s = createMockDebugState();
    assert.equal(s.bpInstr.length, 8);
    assert.equal(s.bpAddr.length, 8);
    assert.equal(s.instrHistory.length, 8);
    assert.equal(s.current.stack.length, 16);
    assert.ok(s.disasm.length > 0);
    assert.ok(s.memDump.length > 0);
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
      "bpInstr",
      "bpAddr",
      "breakInfo",
      "memDump",
      "stackDump",
    ]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(html, /nonce-testnonce/);
  });
});
