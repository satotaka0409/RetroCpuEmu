/**
 * .equ 定義行の抽出・判定（SymbolIndex / 診断 / 単体テスト共用）。
 */

export interface EquDefLine {
  name: string;
  expr: string;
  line: number;
}

/**
 * コメントを除去する（`;` と `//`）。
 * @param line - ソース行
 * @return コメント除去後
 */
export function stripAsmComment(line: string): string {
  const semi = line.indexOf(";");
  const slash = line.indexOf("//");
  let cut = line.length;
  if (semi >= 0) cut = Math.min(cut, semi);
  if (slash >= 0) cut = Math.min(cut, slash);
  return line.slice(0, cut);
}

/**
 * 1行が .equ / equ 定義かどうか（未知命令診断の除外用）。
 * 対応:
 * - `.equ NAME, value` / `equ NAME, value`（カンマ前後の空白可）
 * - `.equ NAME value`（カンマ省略）
 * - `NAME: .equ value` / `NAME: equ value`
 * - `NAME .equ value` / `NAME equ value`（SDAS流）
 * @param line - コメント除去前でも可
 * @return 定義行なら true
 */
export function isEquDefinitionLine(line: string): boolean {
  return matchEquDef(stripAsmComment(line)) !== undefined;
}

/**
 * 1行から .equ 定義を取り出す。
 * @param stripped - コメント除去済み行
 * @return { name, expr }。非該当なら undefined
 */
export function matchEquDef(
  stripped: string,
): { name: string; expr: string } | undefined {
  const s = stripped.trim();
  if (!s) return undefined;

  // NAME: .equ expr / NAME: equ expr
  const labelEqu = s.match(
    /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:\s*(?:\.equ|equ)\b\s*(.+)$/i,
  );
  if (labelEqu) {
    return { name: labelEqu[1]!.toUpperCase(), expr: labelEqu[2]!.trim() };
  }

  // .equ NAME, expr / equ NAME, expr / .equ NAME expr
  const dirEqu = s.match(
    /^(?:\.equ|equ)\b\s+([A-Za-z_.$][A-Za-z0-9_.$]*)(?:\s*,\s*|\s+)(.+)$/i,
  );
  if (dirEqu) {
    return { name: dirEqu[1]!.toUpperCase(), expr: dirEqu[2]!.trim() };
  }

  // NAME .equ expr / NAME equ expr（コロンなし・SDAS流）
  const sdasEqu = s.match(
    /^([A-Za-z_.$][A-Za-z0-9_.$]*)\s+(?:\.equ|equ)\b\s+(.+)$/i,
  );
  if (sdasEqu) {
    return { name: sdasEqu[1]!.toUpperCase(), expr: sdasEqu[2]!.trim() };
  }

  return undefined;
}

/**
 * テキストから .equ 定義を収集する。
 * @param text - ソース全文
 * @return 定義一覧（名前は大文字）
 */
export function collectEquDefs(text: string): EquDefLine[] {
  const lines = text.split(/\r?\n/);
  const found: EquDefLine[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const m = matchEquDef(stripAsmComment(lines[i]!));
    if (!m) continue;
    found.push({ name: m.name, expr: m.expr, line: i });
  }

  return found;
}
