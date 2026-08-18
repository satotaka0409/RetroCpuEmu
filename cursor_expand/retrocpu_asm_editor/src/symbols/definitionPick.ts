import type { AsmSymbol } from "../cpu/types";

/**
 * 定義へ移動の対象。`.global` はエクスポート宣言なので含めない（`name:` / `.equ` のみ）。
 * @param defs 索引の同一名エントリ
 * @returns 本体定義
 */
export function pickDefinitionSymbols(defs: readonly AsmSymbol[]): AsmSymbol[] {
  return defs.filter((d) => d.kind === "label" || d.kind === "equ");
}
