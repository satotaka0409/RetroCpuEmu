/**
 * TMS9995 オペランド診断（sdas 構文）。
 * 根拠: retrocpu_asm tms9995/tms9995_encode / TMS9995_instruction.mdc
 */

import {
  TMS9995_FMT1,
  TMS9995_FMT2_CRU,
  TMS9995_FMT2_JUMP,
  TMS9995_FMT3,
  TMS9995_FMT4,
  TMS9995_FMT5,
  TMS9995_FMT6,
  TMS9995_FMT7,
  TMS9995_FMT8_IMM,
  TMS9995_FMT8_REG,
  TMS9995_FMT8_REG_IMM,
  TMS9995_FMT9_MULDIV,
  TMS9995_FMT9_XOP,
} from "../cpu/tms9995/arch";
import type { CpuArchitecture } from "../cpu/types";
import { tryEvalExpr } from "../expression";
import { stripAsmComment } from "../symbols/equParse";
import type { AsmLineParse } from "../symbols/parseLine";
import type { InvalidRegisterHit } from "./invalidRegisters";

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
 * ワークスペースレジスタ番号を取る。
 * @param tok トークン
 * @returns 0–15。失敗時 undefined
 */
function parseReg(tok: string): number | undefined {
  const m = tok.trim().match(/^R([0-9]|1[0-5])$/i);
  if (!m) return undefined;
  return Number.parseInt(m[1]!, 10);
}

/**
 * TI 風 `@` / `*R` か。
 * @param raw オペランド
 * @returns TI 構文なら true
 */
function isTiSyntax(raw: string): boolean {
  const s = raw.trim();
  return s.startsWith("@") || /^\*\s*R(?:[0-9]|1[0-5])/i.test(s);
}

/**
 * インデックスが R0 か（シンボリックは `addr` のみ。R0 は使えない）。
 * @param raw オペランド
 * @returns R0 インデックスなら true
 */
function isIndexedR0(raw: string): boolean {
  return /^.+\s*[(\[]\s*R0\s*[)\]]\s*$/i.test(raw.trim());
}

/**
 * 即値 `#` で始まっているか。
 * @param raw オペランド
 * @returns `#` 付きなら true
 */
function hasHash(raw: string): boolean {
  return raw.trim().startsWith("#");
}

/**
 * `#` のあとの式を評価する。
 * @param raw オペランド
 * @param symbols 定数表
 * @returns 値。評価不能なら undefined
 */
function evalHashImm(
  raw: string,
  symbols: Map<string, number>,
): number | undefined {
  const s = raw.trim();
  if (!s.startsWith("#")) return undefined;
  return tryEvalExpr(s.slice(1).trim(), symbols);
}

/**
 * 符号付き 16bit として範囲を見る。
 * @param v 評価値
 * @returns 符号拡張した値
 */
function asSigned16(v: number): number {
  return (v << 16) >> 16;
}

/**
 * 汎用アドレスオペランドの構文エラーを列挙する。
 * @param tok オペランド
 * @returns ヒット
 */
function generalAddrHits(tok: {
  text: string;
  absStart: number;
}): InvalidRegisterHit[] {
  const raw = tok.text.trim();
  if (!raw) return [];
  if (hasHash(tok.text)) {
    return [
      hit(tok, "即値 '#' は LI/AI 等専用（汎用アドレスには使えない）"),
    ];
  }
  if (isTiSyntax(raw)) {
    return [
      hit(
        tok,
        "TI 構文は使わない（sdas: (Rn), (Rn)+, ラベル, addr(Rn)）",
      ),
    ];
  }
  if (isIndexedR0(raw)) {
    return [
      hit(tok, "インデックスに R0 は使えない（ラベル／アドレス直書き）"),
    ];
  }
  return [];
}

/**
 * オペランド個数が違うときのヒット。
 * @param parts オペランド
 * @param mnemonicEnd ニーモニック終了列
 * @param want 期待個数
 * @param mnemonic 命令
 * @returns ヒット（0 または 1）
 */
function countHit(
  parts: { text: string; absStart: number }[],
  mnemonicEnd: number,
  want: number,
  mnemonic: string,
): InvalidRegisterHit[] {
  if (parts.length === want) return [];
  const start = parts[0]?.absStart ?? mnemonicEnd;
  const last = parts[parts.length - 1];
  const end = last ? last.absStart + last.text.length : mnemonicEnd + 1;
  return [
    {
      name: mnemonic,
      start,
      end: Math.max(end, start + 1),
      message: `${mnemonic} のオペランド数は ${want}（${parts.length} 個）`,
    },
  ];
}

/**
 * TMS9995 命令の構文・範囲エラーを列挙する。
 * @param line ソース 1 行
 * @param parsed parseAsmLine の結果
 * @param arch CPU
 * @param symbols .equ など評価済み定数
 * @returns 診断ヒット
 */
export function findTms9995SyntaxIssues(
  line: string,
  parsed: AsmLineParse,
  arch: CpuArchitecture,
  symbols: Map<string, number> = new Map(),
): InvalidRegisterHit[] {
  if (arch.id !== "tms9995") return [];
  if (parsed.kind !== "instruction") return [];
  const mnemonic = parsed.mnemonic?.toUpperCase();
  if (!mnemonic) return [];

  const stripped = stripAsmComment(line);
  const mnemonicEnd = parsed.mnemonicEnd ?? 0;
  const parts = splitOperands(stripped.slice(mnemonicEnd), mnemonicEnd);
  const hits: InvalidRegisterHit[] = [];

  if (mnemonic === "RT" || mnemonic === "NOP" || TMS9995_FMT7.has(mnemonic)) {
    return countHit(parts, mnemonicEnd, 0, mnemonic);
  }

  if (TMS9995_FMT8_REG_IMM.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1 && parseReg(parts[0]!.text) === undefined) {
      hits.push(hit(parts[0]!, `${mnemonic} の第1オペランドは Rn`));
    }
    if (parts.length >= 2 && !hasHash(parts[1]!.text)) {
      hits.push(hit(parts[1]!, "即値には '#' が必要（sdas）"));
    }
    return hits;
  }

  if (TMS9995_FMT8_IMM.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 1, mnemonic));
    if (parts.length >= 1 && !hasHash(parts[0]!.text)) {
      hits.push(hit(parts[0]!, "即値には '#' が必要（sdas）"));
    }
    return hits;
  }

  if (TMS9995_FMT8_REG.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 1, mnemonic));
    if (parts.length >= 1 && parseReg(parts[0]!.text) === undefined) {
      hits.push(hit(parts[0]!, `${mnemonic} は Rn が必要`));
    }
    return hits;
  }

  if (TMS9995_FMT2_CRU.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 1, mnemonic));
    if (parts.length < 1) return hits;
    if (!hasHash(parts[0]!.text)) {
      hits.push(hit(parts[0]!, `${mnemonic} は #disp（R12 相対、−128..127）`));
      return hits;
    }
    const v = evalHashImm(parts[0]!.text, symbols);
    if (v !== undefined) {
      const s = asSigned16(v);
      if (s < -128 || s > 127) {
        hits.push(
          hit(parts[0]!, `${mnemonic} の変位 ${s} が範囲外（−128..127）`),
        );
      }
    }
    return hits;
  }

  if (TMS9995_FMT2_JUMP.has(mnemonic)) {
    return countHit(parts, mnemonicEnd, 1, mnemonic);
  }

  if (TMS9995_FMT5.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1 && parseReg(parts[0]!.text) === undefined) {
      hits.push(hit(parts[0]!, `${mnemonic} の第1オペランドは Rn`));
    }
    if (parts.length >= 2) {
      if (!hasHash(parts[1]!.text)) {
        hits.push(hit(parts[1]!, `${mnemonic} の回数は #count（0–15）`));
      } else {
        const v = evalHashImm(parts[1]!.text, symbols);
        if (v !== undefined) {
          const s = asSigned16(v);
          if (s < 0 || s > 15) {
            hits.push(
              hit(parts[1]!, `${mnemonic} の回数 ${s} が範囲外（0–15）`),
            );
          }
        }
      }
    }
    return hits;
  }

  if (TMS9995_FMT3.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1) hits.push(...generalAddrHits(parts[0]!));
    if (parts.length >= 2 && parseReg(parts[1]!.text) === undefined) {
      hits.push(hit(parts[1]!, `${mnemonic} の第2オペランドは Rn`));
    }
    return hits;
  }

  if (TMS9995_FMT4.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1) hits.push(...generalAddrHits(parts[0]!));
    if (parts.length >= 2) {
      if (!hasHash(parts[1]!.text)) {
        hits.push(hit(parts[1]!, `${mnemonic} のビット数は #bits（0–16）`));
      } else {
        const v = evalHashImm(parts[1]!.text, symbols);
        if (v !== undefined) {
          const s = asSigned16(v);
          if (s < 0 || s > 16) {
            hits.push(
              hit(parts[1]!, `${mnemonic} のビット数 ${s} が範囲外（0–16）`),
            );
          }
        }
      }
    }
    return hits;
  }

  if (mnemonic === TMS9995_FMT9_XOP) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1) hits.push(...generalAddrHits(parts[0]!));
    if (parts.length >= 2) {
      if (!hasHash(parts[1]!.text)) {
        hits.push(hit(parts[1]!, "XOP 番号は #n（0–15）"));
      } else {
        const v = evalHashImm(parts[1]!.text, symbols);
        if (v !== undefined) {
          const s = asSigned16(v);
          if (s < 0 || s > 15) {
            hits.push(hit(parts[1]!, `XOP 番号 ${s} が範囲外（0–15）`));
          }
        }
      }
    }
    return hits;
  }

  if (TMS9995_FMT9_MULDIV.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1) hits.push(...generalAddrHits(parts[0]!));
    if (parts.length >= 2 && parseReg(parts[1]!.text) === undefined) {
      hits.push(hit(parts[1]!, `${mnemonic} の第2オペランドは Rn`));
    }
    return hits;
  }

  if (TMS9995_FMT6.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 1, mnemonic));
    if (parts.length >= 1) hits.push(...generalAddrHits(parts[0]!));
    return hits;
  }

  if (TMS9995_FMT1.has(mnemonic)) {
    hits.push(...countHit(parts, mnemonicEnd, 2, mnemonic));
    if (parts.length >= 1) hits.push(...generalAddrHits(parts[0]!));
    if (parts.length >= 2) hits.push(...generalAddrHits(parts[1]!));
    return hits;
  }

  return hits;
}
