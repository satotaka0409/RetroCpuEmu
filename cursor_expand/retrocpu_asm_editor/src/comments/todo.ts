/**
 * `; TODO` コメントの解析（TODO リスト用ハイライト）
 */

/** TODO タグ（単語境界） */
const TODO_TAG = /^TODO\b/i;

/** 1 行上の TODO コメント */
export type TodoComment = {
  /** `;` の列（0-based） */
  commentStart: number;
  /** 行末（排他） */
  commentEnd: number;
  /** `TODO` タグの開始列 */
  tagStart: number;
  /** `TODO` タグの終了列（排他） */
  tagEnd: number;
};

/**
 * 1 行から `; TODO`（大文字小文字不問）を探す。
 * コメント先頭が TODO のときだけヒット（`; note TODO` は対象外）。
 * @param line ソース 1 行（改行なし）
 * @returns ヒット。無ければ null
 */
export function findTodoComment(line: string): TodoComment | null {
  const semi = line.indexOf(";");
  if (semi < 0) return null;
  const comment = line.slice(semi);
  const body = comment.replace(/^;\s*/, "");
  const tagM = body.match(TODO_TAG);
  if (!tagM || tagM.index !== 0) return null;

  const tagStart = semi + (comment.length - body.length);
  const tagEnd = tagStart + tagM[0]!.length;
  return {
    commentStart: semi,
    commentEnd: line.length,
    tagStart,
    tagEnd,
  };
}
