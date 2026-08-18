/**
 * `; @cp` / `; ＠cp` チェックポイント特殊コメントの解析
 * 根拠: asm_editor.mdc
 */

/** 半角 `@` と全角 `＠`（IME） */
const CP_MARKER = /[@\uFF20]cp\b/;

/** チェックポイント名（英字/_ 始まり、英数字と `_` のみ） */
export const CHECKPOINT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 1 行上のチェックポイントコメント */
export type CheckpointComment = {
  /** `;` の列（0-based） */
  commentStart: number;
  /** 行末（排他） */
  commentEnd: number;
  /** `@cp` / `＠cp` の開始列 */
  markerStart: number;
  /** `@cp` / `＠cp` の終了列（排他） */
  markerEnd: number;
  /** 名前トークン。無ければ undefined */
  name?: string;
  /** 名前の開始列 */
  nameStart?: number;
  /** 名前の終了列（排他） */
  nameEnd?: number;
  /** 命名規約を満たすか */
  valid: boolean;
};

/**
 * チェックポイント名として使えるか。
 * @param name 名前
 * @returns 英数字と `_`、先頭は英字/_ なら true
 */
export function isCheckpointName(name: string): boolean {
  return CHECKPOINT_NAME_RE.test(name);
}

/**
 * 1 行から `; @cp` / `; ＠cp` を探す（行コメントの先頭 `;`）。
 * @param line ソース 1 行（改行なし）
 * @returns ヒット。無ければ null
 */
export function findCheckpointComment(line: string): CheckpointComment | null {
  const semi = line.indexOf(";");
  if (semi < 0) {
    return null;
  }
  const comment = line.slice(semi);
  const body = comment.replace(/^;\s*/, "");
  const markerM = body.match(CP_MARKER);
  if (!markerM || markerM.index !== 0) {
    return null;
  }

  const markerStart = semi + (comment.length - body.length);
  const markerEnd = markerStart + markerM[0]!.length;
  const afterMarker = line.slice(markerEnd);
  const leadWs = afterMarker.match(/^[ \t]*/)?.[0] ?? "";
  const rest = afterMarker.slice(leadWs.length);
  const tokenM = rest.match(/^(\S+)/);
  const extraAfterName = tokenM
    ? rest.slice(tokenM[0].length).trim().length > 0
    : rest.trim().length > 0;

  if (!tokenM) {
    return {
      commentStart: semi,
      commentEnd: line.length,
      markerStart,
      markerEnd,
      valid: false,
    };
  }

  const name = tokenM[1]!;
  const nameStart = markerEnd + leadWs.length;
  const nameEnd = nameStart + name.length;
  const valid = isCheckpointName(name) && !extraAfterName;

  return {
    commentStart: semi,
    commentEnd: line.length,
    markerStart,
    markerEnd,
    name,
    nameStart,
    nameEnd,
    valid,
  };
}
