/**
 * アセンブリ1行の分類（vscode 非依存）。
 */

import type { CpuArchitecture } from "../cpu/types";
import { isEquDefinitionLine, stripAsmComment } from "./equParse";

/**
 * アセンブリ1行の解析結果。
 */
export interface AsmLineParse {
  /** 空行・コメントのみ */
  kind: "empty" | "directive" | "instruction" | "unknown";
  /** 命令 / ディレクティブ（大文字） */
  mnemonic?: string;
  /** 元行上のニーモニック開始列（0-based） */
  mnemonicStart?: number;
  /** 元行上のニーモニック終了列（排他） */
  mnemonicEnd?: number;
  /** ラベル参照候補 */
  refs: string[];
}

/** オペランドにラベル参照を持ちうるデータ系ディレクティブ */
const DATA_REF_DIRECTIVES = new Set([
  "DW",
  ".DW",
  "WORD",
  ".WORD",
  "DB",
  ".DB",
  "BYTE",
  ".BYTE",
  "DS",
  ".DS",
  "BLKW",
  ".BLKW",
  "BLKB",
  ".BLKB",
]);

/**
 * ディレクティブ名として認めるか（ドット有無を正規化して判定）。
 * @param token - トークン
 * @param arch - CPU
 * @return ディレクティブなら true
 */
function isDirectiveToken(token: string, arch: CpuArchitecture): boolean {
  const up = token.toUpperCase();
  if (arch.directives.has(up)) return true;
  if (up.startsWith(".") && arch.directives.has(up.slice(1))) return true;
  if (!up.startsWith(".") && arch.directives.has(`.${up}`)) return true;
  return false;
}

/**
 * スキップ条件など、ラベルではない識別子か。
 * @param up - 大文字トークン
 * @return スキップすべきなら true
 */
function isNonLabelIdent(up: string): boolean {
  return /^(SKP|M|PZ|Z|E|NZ|NE|MZ|P|EZ|ENZ|OZ|ONZ|LMZ|LP|LPZ|LM|RE|SE|CE|C)$/.test(
    up,
  );
}

/**
 * オペランドから数値リテラルを除去する（ラベル誤検出防止）。
 * `0b…` / `0x…` / `1010b` / `0FFh` などをスペースに置換する。
 * @param operands - オペランド文字列
 * @return 数値を除いた文字列
 */
function stripNumericLiterals(operands: string): string {
  return (
    operands
      // プレフィックス: 0x / 0b / 0o（先に処理して R0 等の末尾数字を壊さない）
      .replace(/#?0[xX][0-9A-Fa-f]+/g, " ")
      .replace(/#?0[bB][01]+/g, " ")
      .replace(/#?0[oO][0-7]+/g, " ")
      // サフィックス: nnnH / nnnB / nnnO|Q / nnnD / $hex
      .replace(/#?\$[0-9A-Fa-f]+/g, " ")
      .replace(/#?[0-9][0-9A-Fa-f]*[Hh]\b/g, " ")
      .replace(/#?[01]+[Bb]\b/g, " ")
      .replace(/#?[0-7]+[OoQq]\b/g, " ")
      .replace(/#?[0-9]+[Dd]\b/g, " ")
      // 10進（単語境界 — R0 の 0 は消さない）
      .replace(/#?\b[0-9]+\b/g, " ")
  );
}

/**
 * オペランド文字列からラベル参照候補を抽出する。
 * `LABEL+2` / `LABEL(R1)` なども識別子単位で拾う。
 * @param operands - オペランド部分
 * @param arch - CPU
 * @return 参照名一覧（大文字・重複なし）
 */
function collectOperandRefs(
  operands: string,
  arch: CpuArchitecture,
): string[] {
  // 文字列リテラル・数値リテラルは除外
  const cleaned = stripNumericLiterals(
    operands.replace(/"[^"]*"/g, " ").replace(/'[^']*'/g, " "),
  );
  const refs: string[] = [];
  const seen = new Set<string>();
  const re = /[A-Za-z_.$][A-Za-z0-9_.$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    // `0b11100000` / `0xFFFF` の先頭 0 の直後を識別子にしない
    if (m.index > 0 && /[A-Za-z0-9_.$]/.test(cleaned.charAt(m.index - 1))) {
      continue;
    }
    const up = m[0].toUpperCase();
    if (seen.has(up)) continue;
    if (arch.registers.has(up)) continue;
    if (arch.mnemonics.has(up)) continue;
    if (isDirectiveToken(up, arch)) continue;
    if (isNonLabelIdent(up)) continue;
    seen.add(up);
    refs.push(up);
  }
  return refs;
}

/**
 * 命令 / データディレクティブのオペランドからラベル参照を集める。
 * @param body - ラベル除去後の行本文（ニーモニック含む）
 * @param arch - CPU
 * @return 参照名一覧
 */
function collectLabelRefs(body: string, arch: CpuArchitecture): string[] {
  const ws = body.search(/\s/);
  if (ws < 0) return [];
  return collectOperandRefs(body.slice(ws), arch);
}

const GLOBAL_DIRECTIVE_RE = /^\s*\.?(?:global|globl)\b\s*(.*)$/i;

/**
 * `.global` / `.globl` 行ならオペランドのシンボル名（大文字）を返す。
 * カンマ区切りの複数名に対応する。宣言であり未定義ラベル診断の対象ではない。
 * @param line ソース 1 行（コメント付き可）
 * @returns 名前一覧。該当しなければ null
 */
export function parseGlobalDirectiveNames(line: string): string[] | null {
  const stripped = stripAsmComment(line);
  const m = stripped.match(GLOBAL_DIRECTIVE_RE);
  if (!m) return null;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of m[1]!.split(",")) {
    const ident = part.trim().match(/^[A-Za-z_.$][A-Za-z0-9_.$]*/);
    if (!ident) continue;
    const up = ident[0]!.toUpperCase();
    if (seen.has(up)) continue;
    seen.add(up);
    names.push(up);
  }
  return names;
}

/**
 * データ系など、オペランドのラベル参照を診断対象にするディレクティブか。
 * @param mnemonic - 大文字（ドット付き可）
 * @return 対象なら true
 */
function isLabelRefDirective(mnemonic: string): boolean {
  const up = mnemonic.toUpperCase();
  if (DATA_REF_DIRECTIVES.has(up)) return true;
  if (up.startsWith(".") && DATA_REF_DIRECTIVES.has(up.slice(1))) return true;
  return false;
}

/**
 * 1行を命令 / ディレクティブ / 未知トークンに分類する。
 * @param line - ソース行
 * @param arch - CPU
 * @return 解析結果
 */
export function parseAsmLine(
  line: string,
  arch: CpuArchitecture,
): AsmLineParse {
  const stripped = stripAsmComment(line);
  if (!stripped.trim()) return { kind: "empty", refs: [] };

  // .equ NAME, value / NAME .equ value 等は必ずディレクティブ（未知命令にしない）
  if (isEquDefinitionLine(stripped)) {
    return { kind: "directive", mnemonic: "EQU", refs: [] };
  }

  const labelRe = /^(\s*)([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:/;
  const labelM = stripped.match(labelRe);
  const afterLabel = labelM ? stripped.slice(labelM[0].length) : stripped;
  const leadWs = afterLabel.match(/^\s*/)?.[0].length ?? 0;
  const body = afterLabel.trim();
  if (!body) return { kind: "empty", refs: [] };

  const tokenM = body.match(/^([A-Za-z_.$][A-Za-z0-9_.$]*)/);
  if (!tokenM) return { kind: "empty", refs: [] };

  const rawTok = tokenM[1]!;
  const mnemonic = rawTok.toUpperCase();
  const mnemonicStart = (labelM ? labelM[0].length : 0) + leadWs;
  const mnemonicEnd = mnemonicStart + rawTok.length;

  // NAME EQU expr（上で拾えない変形の保険）
  const rest = body.slice(rawTok.length).trimStart();
  const restFirst = rest
    .match(/^(\.?[A-Za-z_][A-Za-z0-9_.$]*)/)?.[1]
    ?.toUpperCase();
  if (
    restFirst &&
    (restFirst === "EQU" ||
      restFirst === ".EQU" ||
      isDirectiveToken(restFirst, arch))
  ) {
    return {
      kind: "directive",
      mnemonic: restFirst.replace(/^\./, ""),
      refs: [],
    };
  }

  // `.ds` / `.area` など、ドット始まりは疑似命令（一覧に無くても未知命令にしない）
  if (isDirectiveToken(mnemonic, arch) || mnemonic.startsWith(".")) {
    const refs = isLabelRefDirective(mnemonic)
      ? collectLabelRefs(body, arch)
      : [];
    return {
      kind: "directive",
      mnemonic,
      mnemonicStart,
      mnemonicEnd,
      refs,
    };
  }

  if (arch.mnemonics.has(mnemonic)) {
    const refs = collectLabelRefs(body, arch);
    return {
      kind: "instruction",
      mnemonic,
      mnemonicStart,
      mnemonicEnd,
      refs,
    };
  }

  return {
    kind: "unknown",
    mnemonic,
    mnemonicStart,
    mnemonicEnd,
    refs: [],
  };
}

/**
 * 行から命令とオペランドらしき識別子を取り出す。
 * @param line - ソース行
 * @param arch - CPU
 * @return { mnemonic, refs }
 */
export function extractLabelRefs(
  line: string,
  arch: CpuArchitecture,
): { mnemonic?: string; refs: string[] } {
  const parsed = parseAsmLine(line, arch);
  if (parsed.kind !== "instruction" && parsed.kind !== "directive") {
    return { refs: [] };
  }
  return { mnemonic: parsed.mnemonic, refs: parsed.refs };
}
