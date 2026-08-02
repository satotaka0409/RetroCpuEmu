import type { AssemblyResult, EmittedWord } from "./types";

/**
 * 数値を4桁ゼロ埋め16進文字列に変換する。
 * @param v - 16進文字列化する数値
 * @return 4桁ゼロ埋め16進文字列
 */
function hex4(v: number): string {
  return (v & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * アセンブル結果をLST形式テキストに変換する。
 * @param result - アセンブル結果
 * @return LST形式テキスト
 */
export function writeLst(result: AssemblyResult): string {
  const byLine: Map<number, EmittedWord[]> = new Map();
  for (const w of result.words) {
    const arr: EmittedWord[] = byLine.get(w.lineNo) ?? [];
    arr.push(w);
    byLine.set(w.lineNo, arr);
  }

  const out: string[] = [];
  for (const src of result.sourceLines) {
    const lineWords: EmittedWord[] = byLine.get(src.lineNo) ?? [];
    if (lineWords.length === 0) {
      out.push(`          ${src.text}`);
      continue;
    }

    for (let i: number = 0; i < lineWords.length; i += 1) {
      const w: EmittedWord = lineWords[i];
      const prefix: string = `${hex4(w.address)} ${hex4(w.value)} `;
      if (i === 0) {
        out.push(`${prefix} ${src.text}`);
      } else {
        out.push(`${prefix}`);
      }
    }
  }
  return out.join("\n") + "\n";
}
