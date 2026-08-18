import { stripLineComment } from "./parser";
import type { CpuType } from "./types";

/** `.cpu` / `--cpu` で指定できる CPU */
export const CPU_TYPES: readonly CpuType[] = ["mn1613", "tms9995"];

/**
 * CPU 名を正規化する（大文字小文字無視）。
 * @param value 入力文字列
 * @returns 既知なら CpuType。不明なら null
 */
export function parseCpuType(value: string | undefined): CpuType | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === "mn1613" || v === "tms9995") return v;
  return null;
}

/**
 * 行末コメントを除いた本文を返す。
 * @param line 1 行
 * @returns トリム済み本文
 */
function lineBody(line: string): string {
  return stripLineComment(line).trim();
}

/**
 * ソース先頭（コメント・空行を除く）の `.cpu` を読む。
 * `.cpu` が後段にある、値が不正、重複、オペランド無しはエラー。
 * @param sourceText アセンブラソース全文
 * @returns `.cpu` があればその CPU。無ければ undefined
 */
export function scanSourceCpu(sourceText: string): CpuType | undefined {
  const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
  let seenContent = false;
  let found: CpuType | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const body = lineBody(lines[i]!);
    if (!body) continue;

    const m = body.match(/^\.cpu(?:\s+(\S+))?$/i);
    if (m) {
      if (seenContent) {
        throw new Error(
          `Line ${i + 1}: .cpu must be the first non-comment line`,
        );
      }
      if (found !== undefined) {
        throw new Error(`Line ${i + 1}: duplicate .cpu directive`);
      }
      const raw = m[1];
      if (!raw) {
        throw new Error(`Line ${i + 1}: .cpu requires mn1613 or tms9995`);
      }
      const cpu = parseCpuType(raw);
      if (!cpu) {
        throw new Error(
          `Line ${i + 1}: unknown .cpu '${raw}' (mn1613 / tms9995)`,
        );
      }
      found = cpu;
      seenContent = true;
      continue;
    }

    seenContent = true;
  }

  return found;
}

/**
 * CLI / 引数の CPU とソース `.cpu` から実際に使う CPU を決める。
 * 引数があればそれを優先。どちらも無ければエラー。
 * @param explicit `--cpu` / `assemble()` 第 2 引数。未指定は undefined
 * @param sourceText アセンブラソース全文
 * @returns 確定した CPU
 */
export function resolveCpuType(
  explicit: CpuType | undefined,
  sourceText: string,
): CpuType {
  const fromSource = scanSourceCpu(sourceText);
  if (explicit) return explicit;
  if (fromSource) return fromSource;
  throw new Error(
    "CPU が未指定です（--cpu / -m または先頭の .cpu で mn1613 / tms9995 を指定してください）",
  );
}
