/**
 * .include パス解決（vscode 非依存）。
 */

import * as path from "node:path";
import { stripAsmComment } from "./equParse";

/**
 * ソースから .include / INCLUDE のオペランドを集める。
 * @param text - ソース全文
 * @return オペランド文字列一覧
 */
export function collectIncludePaths(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const stripped = stripAsmComment(line);
    const m = stripped.match(/^\s*(?:\.include|include)\b\s+(.+)$/i);
    if (!m) continue;
    out.push(m[1]!.trim());
  }
  return out;
}

/**
 * include オペランドを絶対パスに解決する。
 * @param baseDir - 基準ディレクトリ
 * @param includeOperand - オペランド（引用符可）
 * @return 絶対パス。失敗時 undefined
 */
export function resolveIncludePath(
  baseDir: string,
  includeOperand: string,
): string | undefined {
  let p = includeOperand.trim();
  if (
    (p.startsWith('"') && p.endsWith('"')) ||
    (p.startsWith("'") && p.endsWith("'"))
  ) {
    p = p.slice(1, -1);
  }
  if (!p) return undefined;
  return path.resolve(baseDir, p);
}
