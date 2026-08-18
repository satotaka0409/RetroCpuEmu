/**
 * `; @unwarning` 解析と未使用グローバル警告の抑止判定
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  findUnwarningComment,
  isCommentOnlyUnwarning,
  unusedGlobalWarningSuppressed,
} from "./unwarning";

describe("findUnwarningComment", () => {
  test("行頭の ; @unwarning", () => {
    const hit = findUnwarningComment("\t; @unwarning");
    assert.ok(hit);
    assert.equal(hit!.commentStart, 1);
    assert.match("\t; @unwarning".slice(hit!.markerStart, hit!.markerEnd), /unwarning/i);
  });

  test(".global 行末尾の ; @unwarning", () => {
    const line = "\t.global g_foo\t; @unwarning";
    const hit = findUnwarningComment(line);
    assert.ok(hit);
    assert.equal(line.slice(hit!.commentStart), "; @unwarning");
  });

  test("全角 ＠unwarning も認める", () => {
    assert.ok(findUnwarningComment("; ＠unwarning"));
  });

  test("通常コメントはヒットしない", () => {
    assert.equal(findUnwarningComment("; 外部公開 API"), null);
  });

  test("コメント途中の @unwarning は対象外", () => {
    assert.equal(findUnwarningComment("; note @unwarning later"), null);
  });

  test("; @cp は対象外", () => {
    assert.equal(findUnwarningComment("; @cp g_get_rnd"), null);
  });
});

describe("isCommentOnlyUnwarning", () => {
  test("コメント専用行は true", () => {
    assert.equal(isCommentOnlyUnwarning("\t; @unwarning"), true);
  });

  test("命令行末尾は false", () => {
    assert.equal(isCommentOnlyUnwarning("\t.global g_foo ; @unwarning"), false);
  });
});

describe("unusedGlobalWarningSuppressed", () => {
  /**
   * @param lines ソース行
   * @param lineNo 判定する行
   * @returns 抑止するか
   */
  function sup(lines: string[], lineNo: number): boolean {
    return unusedGlobalWarningSuppressed((i) => lines[i], lineNo);
  }

  test("直前の ; @unwarning で次の .global だけ抑止する", () => {
    const lines = [
      "\t.global g_rnd_init",
      "\t; @unwarning",
      "\t.global g_mem_cpy",
      "\t.global g_malloc_init",
    ];
    assert.equal(sup(lines, 0), false);
    assert.equal(sup(lines, 2), true);
    assert.equal(sup(lines, 3), false);
  });

  test("空行を挟んでも直前の @unwarning が効く", () => {
    const lines = ["\t; @unwarning", "", "\t.global g_free"];
    assert.equal(sup(lines, 2), true);
  });

  test("同一行の ; @unwarning で抑止する", () => {
    const lines = ["\t.global g_malloc ; @unwarning"];
    assert.equal(sup(lines, 0), true);
  });

  test("通常コメントの直後は抑止しない", () => {
    const lines = ["\t; 公開 API", "\t.global g_foo"];
    assert.equal(sup(lines, 1), false);
  });
});
