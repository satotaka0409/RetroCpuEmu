/**
 * `; @unwarning` / `; ＠unwarning` 特殊コメント。
 * 直後（または同一行）の `.global` / `.globl` の未使用警告を抑止する。
 */

/** 半角 `@` と全角 `＠`（IME） */
const UNWARNING_MARKER = /[@\uFF20]unwarning\b/i;

/** 1 行上の `@unwarning` コメント */
export type UnwarningComment = {
  /** `;` の列（0-based） */
  commentStart: number;
  /** 行末（排他） */
  commentEnd: number;
  /** `@unwarning` / `＠unwarning` の開始列 */
  markerStart: number;
  /** `@unwarning` / `＠unwarning` の終了列（排他） */
  markerEnd: number;
};

/**
 * 1 行から `; @unwarning` / `; ＠unwarning` を探す（行コメントの先頭 `;`）。
 * コメント先頭がマーカーのときだけヒット（`; note @unwarning` は対象外）。
 * @param line ソース 1 行（改行なし）
 * @returns ヒット。無ければ null
 */
export function findUnwarningComment(line: string): UnwarningComment | null {
  const semi = line.indexOf(";");
  if (semi < 0) return null;
  const comment = line.slice(semi);
  const body = comment.replace(/^;\s*/, "");
  const markerM = body.match(UNWARNING_MARKER);
  if (!markerM || markerM.index !== 0) return null;

  const markerStart = semi + (comment.length - body.length);
  const markerEnd = markerStart + markerM[0]!.length;
  return {
    commentStart: semi,
    commentEnd: line.length,
    markerStart,
    markerEnd,
  };
}

/**
 * 空白と `; @unwarning` だけの行か。
 * 命令行末尾の `; @unwarning` は false（同一行の `.global` 側で見る）。
 * @param line ソース 1 行
 * @returns コメント専用の `@unwarning` なら true
 */
export function isCommentOnlyUnwarning(line: string): boolean {
  const semi = line.indexOf(";");
  if (semi < 0) return false;
  if (line.slice(0, semi).trim() !== "") return false;
  return findUnwarningComment(line) !== null;
}

/**
 * この `.global` 行の未使用警告を抑止するか。
 * 同一行に `; @unwarning` があるか、直前の非空行がコメント専用 `@unwarning`（空行は飛ばす）。
 * 連続する `.global` には効かない（各宣言の直上または同一行が必要）。
 * @param lineAt 行番号 → テキスト（範囲外は undefined）
 * @param lineNo `.global` 行の 0-based 番号
 * @returns 抑止するなら true
 */
export function unusedGlobalWarningSuppressed(
  lineAt: (i: number) => string | undefined,
  lineNo: number,
): boolean {
  const cur = lineAt(lineNo);
  if (cur && findUnwarningComment(cur)) return true;
  for (let i = lineNo - 1; i >= 0; i -= 1) {
    const prev = lineAt(i);
    if (prev === undefined) return false;
    if (prev.trim() === "") continue;
    return isCommentOnlyUnwarning(prev);
  }
  return false;
}
