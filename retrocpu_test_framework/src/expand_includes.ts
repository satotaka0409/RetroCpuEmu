import fs from "node:fs";
import path from "node:path";

/** リンカ結合すべきソース拡張子（.include 禁止） */
const SOURCE_EXTS = new Set([".asm", ".s", ".mn1610", ".mn1613", ".tms9995"]);

/**
 * 行からコメントを除く（`;` / `//`）。
 * @param line 1 行
 * @returns コメント除去後
 */
function stripLineComment(line: string): string {
  const semi = line.indexOf(";");
  const slash = line.indexOf("//");
  let cut = line.length;
  if (semi >= 0) cut = Math.min(cut, semi);
  if (slash >= 0) cut = Math.min(cut, slash);
  return line.slice(0, cut);
}

/**
 * INCLUDE オペランドからパスを取り出す。
 * @param operandText `.include` のオペランド
 * @returns ファイルパス
 */
function parseIncludeOperand(operandText: string): string {
  const trimmed = operandText.trim();
  if (!trimmed) {
    throw new Error("INCLUDE requires a file path.");
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * `.include` を再帰展開する。`.asm` 等のソース取り込みは禁止（リンカで結合する）。
 * 根拠: asm-rules.mdc（`.asm` は include せず `.rel` をリンク）
 * @param sourceText ソース全文
 * @param fromDir `.include` 相対パスの基準ディレクトリ
 * @param includeStack 循環検出用スタック
 * @returns 展開済みソース
 */
export function expandIncludes(
  sourceText: string,
  fromDir: string,
  includeStack: string[] = [],
): string {
  const absDir = path.resolve(fromDir);
  const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const body = stripLineComment(raw).trim();
    const m = body.match(/^(?:\.INCLUDE|INCLUDE)\s+(.+)$/i);
    if (!m) {
      out.push(raw);
      continue;
    }

    const includeOperand = parseIncludeOperand(m[1]);
    const includeFile = path.isAbsolute(includeOperand)
      ? includeOperand
      : path.resolve(absDir, includeOperand);
    const absInclude = path.resolve(includeFile);
    const ext = path.extname(absInclude).toLowerCase();

    if (SOURCE_EXTS.has(ext)) {
      throw new Error(
        `Cannot .include assembler source '${includeOperand}' (${absDir}:${i + 1}). ` +
          "Assemble each .asm separately and link with the linker.",
      );
    }
    if (includeStack.includes(absInclude)) {
      throw new Error(
        `Include cycle detected: ${[...includeStack, absInclude].join(" -> ")}`,
      );
    }
    if (!fs.existsSync(absInclude)) {
      throw new Error(
        `Include file not found: ${includeOperand} (${absDir}:${i + 1})`,
      );
    }

    const nested = fs.readFileSync(absInclude, "utf8");
    out.push(
      expandIncludes(nested, path.dirname(absInclude), [
        ...includeStack,
        absInclude,
      ]),
    );
  }

  return out.join("\n");
}

/**
 * ファイル起点で `.include` を展開する。
 * @param entryPath 起点 ASM
 * @returns 展開済みソース
 */
export function expandIncludesFromFile(entryPath: string): string {
  const absPath = path.resolve(entryPath);
  const text = fs.readFileSync(absPath, "utf8");
  return expandIncludes(text, path.dirname(absPath), [absPath]);
}
