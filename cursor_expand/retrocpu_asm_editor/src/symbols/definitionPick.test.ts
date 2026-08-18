/**
 * 定義へ移動の対象選択
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AsmSymbol } from "../cpu/types";
import { pickDefinitionSymbols } from "../symbols/definitionPick";

/**
 * テスト用の最小シンボル。
 * @param kind 種別
 * @param line 行
 * @returns シンボル
 */
function sym(kind: AsmSymbol["kind"], line: number): AsmSymbol {
  return { name: "G_HSHK_RECV_BYTE", kind, uri: `file://${kind}/${line}`, line };
}

describe("pickDefinitionSymbols", () => {
  test("label 本体だけ残し .global は捨てる", () => {
    const picked = pickDefinitionSymbols([
      sym("global", 21),
      sym("global", 8),
      sym("label", 40),
      sym("global", 3),
    ]);
    assert.equal(picked.length, 1);
    assert.equal(picked[0]!.kind, "label");
    assert.equal(picked[0]!.line, 40);
  });

  test(".equ は定義として残す", () => {
    const picked = pickDefinitionSymbols([sym("global", 1), sym("equ", 10)]);
    assert.equal(picked.length, 1);
    assert.equal(picked[0]!.kind, "equ");
  });

  test("本体が無ければ空（.global だけでは飛ばない）", () => {
    assert.deepEqual(pickDefinitionSymbols([sym("global", 1)]), []);
  });
});
