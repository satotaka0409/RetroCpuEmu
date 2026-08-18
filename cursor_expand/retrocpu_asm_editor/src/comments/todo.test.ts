import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findTodoComment } from "./todo";

describe("findTodoComment", () => {
  test("行頭の ; TODO", () => {
    const hit = findTodoComment("; TODO send handshake");
    assert.ok(hit);
    assert.equal(hit!.commentStart, 0);
    assert.equal(hit!.tagStart, 2);
    assert.equal(hit!.tagEnd, 6);
  });

  test("命令行末尾の ; TODO", () => {
    const hit = findTodoComment("\tpopm\t\t; TODO: レジスタを送信");
    assert.ok(hit);
    assert.equal(hit!.commentStart, hit!.tagStart - 2); // "; "
    assert.match(
      "\tpopm\t\t; TODO: レジスタを送信".slice(hit!.tagStart, hit!.tagEnd),
      /^TODO$/i,
    );
  });

  test("小文字 todo も認める", () => {
    assert.ok(findTodoComment("; todo later"));
  });

  test("通常コメントはヒットしない", () => {
    assert.equal(findTodoComment("; 割り込みハンドラー"), null);
  });

  test("コメント途中の TODO は対象外", () => {
    assert.equal(findTodoComment("; note TODO later"), null);
  });

  test("; @cp は対象外", () => {
    assert.equal(findTodoComment("; @cp undefined_instruction"), null);
  });
});
