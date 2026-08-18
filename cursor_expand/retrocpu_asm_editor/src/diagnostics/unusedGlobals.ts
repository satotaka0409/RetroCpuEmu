/**
 * `.global` / `.globl` 宣言があるがオペランド参照が無いラベルの警告。
 */

import { parseAsmLine, parseGlobalDirectiveNames } from "../symbols/parseLine";
import { findIdentRangesInLine } from "../symbols/occurrences";
import type { CpuArchitecture } from "../cpu/types";
import type { InvalidRegisterHit } from "./invalidRegisters";

/**
 * グローバル宣言のうち、使用箇所が無い名前を列挙する。
 * @param line ソース 1 行
 * @param arch CPU（ニーモニック列の特定用）
 * @param isReferenced ワークスペースにオペランド参照があるか
 * @returns 警告ヒット（`.global` 上の識別子）
 */
export function findUnusedGlobalDeclarations(
  line: string,
  arch: CpuArchitecture,
  isReferenced: (name: string) => boolean,
): InvalidRegisterHit[] {
  const names = parseGlobalDirectiveNames(line);
  if (!names || names.length === 0) return [];

  const parsed = parseAsmLine(line, arch);
  const from = parsed.mnemonicEnd ?? 0;
  const hits: InvalidRegisterHit[] = [];
  for (const name of names) {
    if (isReferenced(name)) continue;
    const ranges = findIdentRangesInLine(line, name, from);
    for (const r of ranges) {
      hits.push({
        name,
        start: r.start,
        end: r.end,
        message: `使用箇所が見つかりません: ${name}`,
      });
    }
  }
  return hits;
}
