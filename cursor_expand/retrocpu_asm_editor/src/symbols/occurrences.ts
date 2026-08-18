/**
 * シンボル定義・参照の出現位置収集（vscode 非依存）。
 */

import type { CpuArchitecture } from "../cpu/types";
import { matchEquDef, stripAsmComment } from "./equParse";
import { parseAsmLine, parseGlobalDirectiveNames } from "./parseLine";

/**
 * シンボルの1出現。
 */
export interface SymbolOccurrence {
  line: number;
  start: number;
  end: number;
  kind: "declaration" | "reference";
}

/**
 * 識別子文字かどうか。
 * @param c - 1文字
 * @return 識別子に使えるなら true
 */
function isIdentChar(c: string): boolean {
  return /[A-Za-z0-9_.$]/.test(c);
}

/**
 * 行内の識別子出現位置を返す（単語境界付き）。
 * @param line - ソース行
 * @param name - 大文字のシンボル名
 * @param fromCol - 検索開始列
 * @return 開始・終了列の一覧
 */
export function findIdentRangesInLine(
  line: string,
  name: string,
  fromCol = 0,
): Array<{ start: number; end: number }> {
  const target = name.toUpperCase();
  const upper = line.toUpperCase();
  const out: Array<{ start: number; end: number }> = [];
  let i = Math.max(0, fromCol);
  while (i < upper.length) {
    const idx = upper.indexOf(target, i);
    if (idx < 0) break;
    const end = idx + target.length;
    const beforeOk = idx === 0 || !isIdentChar(line[idx - 1]!);
    const afterOk = end >= line.length || !isIdentChar(line[end]!);
    if (beforeOk && afterOk) out.push({ start: idx, end });
    i = idx + 1;
  }
  return out;
}

/**
 * テキスト内のシンボル定義・参照を収集する。
 * @param text - ソース全文
 * @param name - シンボル名（大文字小文字不問）
 * @param arch - CPU
 * @param includeDeclaration - 定義（ラベル / .equ）を含めるか
 * @return 出現一覧
 */
export function collectSymbolOccurrences(
  text: string,
  name: string,
  arch: CpuArchitecture,
  includeDeclaration: boolean,
): SymbolOccurrence[] {
  const target = name.toUpperCase();
  const lines = text.split(/\r?\n/);
  const out: SymbolOccurrence[] = [];
  const seen = new Set<string>();

  const push = (
    line: number,
    start: number,
    end: number,
    kind: SymbolOccurrence["kind"],
  ): void => {
    const key = `${line}:${start}:${end}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ line, start, end, kind });
  };

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo]!;
    const stripped = stripAsmComment(line);

    if (includeDeclaration) {
      const labelM = stripped.match(
        /^(\s*)([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:/,
      );
      if (labelM && labelM[2]!.toUpperCase() === target) {
        const start = (labelM[1]?.length ?? 0);
        push(lineNo, start, start + labelM[2]!.length, "declaration");
      }

      const equ = matchEquDef(stripped);
      if (equ && equ.name === target) {
        const ranges = findIdentRangesInLine(line, target);
        if (ranges[0]) {
          push(lineNo, ranges[0].start, ranges[0].end, "declaration");
        }
      }

      const globalNames = parseGlobalDirectiveNames(stripped);
      if (globalNames?.includes(target)) {
        const parsed = parseAsmLine(line, arch);
        const from =
          parsed.mnemonicEnd !== undefined ? parsed.mnemonicEnd : 0;
        for (const r of findIdentRangesInLine(line, target, from)) {
          push(lineNo, r.start, r.end, "declaration");
        }
      }
    }

    const parsed = parseAsmLine(line, arch);
    if (
      (parsed.kind === "instruction" || parsed.kind === "directive") &&
      parsed.refs.includes(target)
    ) {
      const from =
        parsed.mnemonicEnd !== undefined ? parsed.mnemonicEnd : 0;
      for (const r of findIdentRangesInLine(line, target, from)) {
        push(lineNo, r.start, r.end, "reference");
      }
    }
  }

  return out;
}

/**
 * ソース内のラベル定義と `.equ` 名を集める（大文字）。
 * `.global` 宣言だけは含めない。
 * @param text ソース全文
 * @returns 定義名の集合
 */
export function collectLabelDefNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const stripped = stripAsmComment(line);
    const labelM = stripped.match(/^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:/);
    if (labelM) names.add(labelM[1]!.toUpperCase());
    const equ = matchEquDef(stripped);
    if (equ) names.add(equ.name);
  }
  return names;
}

/**
 * 命令・データディレクティブのオペランドにあるラベル参照を数える。
 * `.global` / `.globl` 宣言とラベル定義そのものは含めない。
 * @param text ソース全文
 * @param arch CPU
 * @returns 名前（大文字）→ 出現回数
 */
export function collectOperandRefCounts(
  text: string,
  arch: CpuArchitecture,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    if (parseGlobalDirectiveNames(line) !== null) continue;
    const parsed = parseAsmLine(line, arch);
    if (parsed.kind !== "instruction" && parsed.kind !== "directive") {
      continue;
    }
    for (const name of parsed.refs) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}
