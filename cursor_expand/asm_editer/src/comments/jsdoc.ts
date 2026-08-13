import type { SubroutineDoc } from "../cpu/types";

/**
 * ラベル直前の JSDoc 風コメントをパースする。
 *
 * 対応例（asm-rules.mdc）:
 * ```
 * ; ホゲホゲを取得する
 * ; @note 詳しい説明
 * ; @param R0 - 第1引数
 * ; @param R1 - 第2引数
 * ; @return R0 - 戻り値
 * ; @Destruction R1 - 破壊レジスタ
 * getHogehoge:
 * ```
 *
 * @param lines - ソース行配列
 * @param labelLineIndex - ラベル行の 0-based インデックス
 * @return ドキュメント。なければ undefined
 */
export function parseSubroutineDocAbove(
  lines: string[],
  labelLineIndex: number,
): SubroutineDoc | undefined {
  const collected: string[] = [];
  for (let i = labelLineIndex - 1; i >= 0; i -= 1) {
    const t = (lines[i] ?? "").trim();
    if (t === "") {
      if (collected.length > 0) break;
      continue;
    }
    // 区切り線はスキップ（ブロックを分断しない）
    if (/^;+\s*-{3,}/.test(t)) continue;
    const m = t.match(/^;+\s?(.*)$/);
    if (!m) break;
    const body = m[1]!.replace(/^\*\s?/, "").trim();
    if (/^[@\uFF20]cp\b/i.test(body)) continue;
    collected.unshift(body);
  }

  if (collected.length === 0) return undefined;
  const hasTag = collected.some((c) => /^@\w+/i.test(c));
  if (!hasTag) return undefined;

  let brief: string | undefined;
  let note: string | undefined;
  const params: Array<{ name: string; description: string }> = [];
  let returns: string | undefined;
  const clobbers: string[] = [];

  for (const line of collected) {
    if (!line) continue;

    const briefM = line.match(/^@brief\s+(.+)$/i);
    if (briefM) {
      brief = briefM[1]!.trim();
      continue;
    }
    const noteM = line.match(/^@note\s+(.+)$/i);
    if (noteM) {
      note = noteM[1]!.trim();
      continue;
    }
    const paramM = line.match(/^@param(?:\[[^\]]*\])?\s+(\S+)\s*-?\s*(.*)$/i);
    if (paramM) {
      params.push({ name: paramM[1]!, description: paramM[2]!.trim() });
      continue;
    }
    const retM = line.match(/^@returns?\s+(.+)$/i);
    if (retM) {
      returns = retM[1]!.trim().replace(/^-\s*/, "");
      continue;
    }
    // @Destruction / @clobber — 破壊レジスタ
    const destM = line.match(/^@(?:destruction|clobber(?:s)?)\s+(.+)$/i);
    if (destM) {
      const body = destM[1]!.replace(/\s*-.*$/, "").trim();
      for (const part of body.split(/[,、\s]+/)) {
        const tok = part.trim();
        if (!tok) continue;
        // R0-R2 / R0〜R2 のような範囲
        const rangeM = tok.match(/^([Rr]\d+)\s*[-〜~]\s*([Rr]\d+)$/);
        if (rangeM) {
          const a = Number.parseInt(rangeM[1]!.slice(1), 10);
          const b = Number.parseInt(rangeM[2]!.slice(1), 10);
          for (let r = Math.min(a, b); r <= Math.max(a, b); r += 1) {
            clobbers.push(`R${r}`);
          }
          continue;
        }
        clobbers.push(tok.toUpperCase());
      }
      continue;
    }

    // 先頭のタグなし行を brief にする
    if (!/^@\w+/i.test(line) && brief === undefined) {
      brief = line;
    }
  }

  if (note) {
    brief = brief ? `${brief}\n\n${note}` : note;
  }

  return {
    brief,
    params,
    returns,
    clobbers,
    raw: collected.join("\n"),
  };
}

/**
 * SubroutineDoc を Markdown にする。
 * @param doc - ドキュメント
 * @param symbolName - シンボル名
 * @return Markdown 文字列
 */
export function formatSubroutineDocMarkdown(
  doc: SubroutineDoc,
  symbolName: string,
): string {
  const parts: string[] = [`### \`${symbolName}\``];
  if (doc.brief) parts.push("", doc.brief);
  if (doc.params.length > 0) {
    parts.push("", "**Parameters**");
    for (const p of doc.params) {
      parts.push(`- \`${p.name}\` — ${p.description || "_"}`);
    }
  }
  if (doc.returns) parts.push("", `**Returns** — ${doc.returns}`);
  if (doc.clobbers.length > 0) {
    parts.push(
      "",
      `**Destruction** — ${doc.clobbers.map((c) => `\`${c}\``).join(", ")}`,
    );
  }
  return parts.join("\n");
}
