/**
 * `; @cp` チェックポイント解析
 * 根拠: asm_editer.mdc
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseSubroutineDocAbove } from "./jsdoc";
import {
  findCheckpointComment,
  isCheckpointName,
} from "./checkpoint";

describe("findCheckpointComment", () => {
  test("行頭の ; @cp NAME", () => {
    const hit = findCheckpointComment("; @cp uart_initialized");
    assert.ok(hit);
    assert.equal(hit!.name, "uart_initialized");
    assert.equal(hit!.valid, true);
    assert.equal(hit!.commentStart, 0);
    assert.equal(
      "; @cp uart_initialized".slice(hit!.commentStart, hit!.commentEnd),
      "; @cp uart_initialized",
    );
  });

  test("命令行末尾の ; @cp", () => {
    const line = "\tnop\t\t; @cp same_line";
    const hit = findCheckpointComment(line);
    assert.ok(hit);
    assert.equal(hit!.name, "same_line");
    assert.equal(hit!.valid, true);
    assert.equal(line.slice(hit!.commentStart), "; @cp same_line");
  });

  test("全角 ＠cp も認める", () => {
    const hit = findCheckpointComment("; ＠cp IOPORT_40_OUTPUT");
    assert.ok(hit);
    assert.equal(hit!.name, "IOPORT_40_OUTPUT");
    assert.equal(hit!.valid, true);
  });

  test("通常コメントはヒットしない", () => {
    assert.equal(findCheckpointComment("; just a comment"), null);
    assert.equal(findCheckpointComment("\tH"), null);
    assert.equal(findCheckpointComment("; @brief add"), null);
  });

  test("日本語・スペース・欠名は invalid", () => {
    assert.equal(findCheckpointComment("; @cp 日本語")!.valid, false);
    assert.equal(findCheckpointComment("; @cp has space")!.valid, false);
    assert.equal(findCheckpointComment("; @cp")!.valid, false);
    assert.equal(findCheckpointComment("; @cp _ok")!.valid, true);
    assert.equal(isCheckpointName("1bad"), false);
  });
});

describe("parseSubroutineDocAbove: @cp は JSDoc に混ぜない", () => {
  test("@cp だけの上はドキュメント無し", () => {
    const lines = ["; @cp uart_initialized", "gl_uart:", "\tret"];
    assert.equal(parseSubroutineDocAbove(lines, 1), undefined);
  });

  test("@brief と @cp が混在しても brief は残る", () => {
    const lines = [
      "; @brief 初期化",
      "; @cp uart_initialized",
      "gl_uart:",
      "\tret",
    ];
    const doc = parseSubroutineDocAbove(lines, 2);
    assert.ok(doc);
    assert.equal(doc!.brief, "初期化");
    assert.equal(doc!.jsdoc, true);
    assert.equal(doc!.raw.includes("@cp"), false);
  });
});
