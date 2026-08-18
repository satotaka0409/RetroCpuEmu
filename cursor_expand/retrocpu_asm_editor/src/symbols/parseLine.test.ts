/**
 * 1 行解析と `len()` 組み込みのテスト。
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { mn1613Architecture } from "../cpu/mn1613/arch";
import { isAsmBuiltinCall, parseAsmLine } from "./parseLine";

describe("parseAsmLine: len()", () => {
  const arch = mn1613Architecture;

  test("len(label) の LEN は refs にしない（引数ラベルだけ拾う）", () => {
    const p = parseAsmLine("\tmvwi\tR1, #len(hello_msg2)", arch);
    assert.equal(p.kind, "instruction");
    assert.deepEqual(p.refs, ["HELLO_MSG2"]);
  });

  test("hello_lcd の #len(hello_msg1) も LEN を refs にしない", () => {
    const p = parseAsmLine("\tmvwi\tR1, #len(hello_msg1)", arch);
    assert.equal(p.kind, "instruction");
    assert.ok(!p.refs.includes("LEN"));
    assert.deepEqual(p.refs, ["HELLO_MSG1"]);
  });

  test("空白付き #len (label) も LEN を refs にしない", () => {
    const p = parseAsmLine("\tmvwi\tR1, #len (hello_msg1)", arch);
    assert.ok(!p.refs.includes("LEN"));
    assert.deepEqual(p.refs, ["HELLO_MSG1"]);
  });

  test("len ラベル単独参照は refs に残す", () => {
    const p = parseAsmLine("\tb\tlen", arch);
    assert.equal(p.kind, "instruction");
    assert.deepEqual(p.refs, ["LEN"]);
  });
});

describe("isAsmBuiltinCall", () => {
  test("len( だけ真", () => {
    assert.equal(isAsmBuiltinCall("len", "(hello_msg1)"), true);
    assert.equal(isAsmBuiltinCall("LEN", " (msg)"), true);
    assert.equal(isAsmBuiltinCall("len", ""), false);
    assert.equal(isAsmBuiltinCall("hello_msg1", "("), false);
  });
});
