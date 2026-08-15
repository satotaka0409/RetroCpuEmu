/**
 * `.dw` / MVWI の 16bit、MVI の 8bit 即値範囲診断。
 * 根拠: retrocpu_asm encoder u8 / u16。ラベルを含む式は未定義ラベル診断に任せる。
 */

import type { CpuArchitecture } from "../cpu/types";
import type { AsmLineParse } from "../symbols/parseLine";
import { stripAsmComment } from "../symbols/equParse";
import { tryEvalExpr } from "../expression";
import type { InvalidRegisterHit } from "./invalidRegisters";

/** 16bit データディレクティブ */
const DW_OPS = new Set([".DW", "DW", ".WORD", "WORD"]);

/**
 * カンマ区切りオペランドを列位置付きで分割する。
 * @param operand ニーモニック直後
 * @param base 行内の operand 開始列
 * @returns 各オペランド
 */
function splitOperands(
  operand: string,
  base: number,
): { text: string; absStart: number }[] {
  const parts: { text: string; absStart: number }[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= operand.length; i += 1) {
    const c = i < operand.length ? operand[i] : ",";
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (i === operand.length || (c === "," && depth === 0)) {
      parts.push({
        text: operand.slice(start, i),
        absStart: base + start,
      });
      start = i + 1;
    }
  }
  return parts.filter((p) => p.text.trim().length > 0);
}

/**
 * オペランド文字列から即値式を取り出す（先頭 `#` を除く）。
 * @param raw オペランド
 * @returns 式。空なら null
 */
function immExpr(raw: string): string | null {
  let t = raw.trim();
  if (t.startsWith("#")) t = t.slice(1).trim();
  return t.length > 0 ? t : null;
}

/**
 * ヒット 1 件を作る。
 * @param tok オペランド
 * @param message 診断文
 * @returns ヒット
 */
function hit(
  tok: { text: string; absStart: number },
  message: string,
): InvalidRegisterHit {
  const lead = tok.text.match(/^\s*/)?.[0].length ?? 0;
  const body = tok.text.trimEnd();
  const start = tok.absStart + lead;
  return {
    name: body.trim(),
    start,
    end: tok.absStart + body.length,
    message,
  };
}

/**
 * 定数即値がビット幅を超えていれば列挙する。
 * @param line ソース 1 行
 * @param parsed parseAsmLine の結果
 * @param arch CPU
 * @param symbols .equ など評価済み定数（無くても数値リテラルは判定できる）
 * @returns 範囲外ヒット
 */
export function findImmRangeOverflows(
  line: string,
  parsed: AsmLineParse,
  arch: CpuArchitecture,
  symbols: Map<string, number> = new Map(),
): InvalidRegisterHit[] {
  const isMn161x = arch.id === "mn1610" || arch.id === "mn1613";
  if (!isMn161x && arch.id !== "tms9995") return [];
  if (
    parsed.kind !== "instruction" &&
    parsed.kind !== "directive"
  ) {
    return [];
  }
  const mnemonic = parsed.mnemonic?.toUpperCase();
  if (!mnemonic) return [];

  const stripped = stripAsmComment(line);
  const mnemonicEnd = parsed.mnemonicEnd ?? 0;
  const parts = splitOperands(stripped.slice(mnemonicEnd), mnemonicEnd);
  const hits: InvalidRegisterHit[] = [];

  if (isMn161x && mnemonic === "MVI") {
    const tok = parts[1];
    if (!tok) return hits;
    const expr = immExpr(tok.text);
    if (!expr) return hits;
    const v = tryEvalExpr(expr, symbols);
    if (v === undefined) return hits;
    if (!Number.isInteger(v) || v < 0 || v > 0xff) {
      hits.push(
        hit(tok, `即値が 8bit 範囲外です（0〜255）: ${expr}`),
      );
    }
    return hits;
  }

  if (isMn161x && mnemonic === "MVWI") {
    const tok = parts[1];
    if (!tok) return hits;
    const expr = immExpr(tok.text);
    if (!expr) return hits;
    const v = tryEvalExpr(expr, symbols);
    if (v === undefined) return hits;
    if (!Number.isInteger(v) || v < -0x8000 || v > 0xffff) {
      hits.push(
        hit(tok, `即値が 16bit 範囲外です（-32768〜65535）: ${expr}`),
      );
    }
    return hits;
  }

  if (DW_OPS.has(mnemonic)) {
    for (const tok of parts) {
      const expr = immExpr(tok.text);
      if (!expr) continue;
      const v = tryEvalExpr(expr, symbols);
      if (v === undefined) continue;
      if (!Number.isInteger(v) || v < -0x8000 || v > 0xffff) {
        hits.push(
          hit(tok, `.dw の値が 16bit 範囲外です（-32768〜65535）: ${expr}`),
        );
      }
    }
  }

  return hits;
}
