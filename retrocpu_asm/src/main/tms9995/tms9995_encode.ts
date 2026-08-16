/**
 * TMS9995 命令エンコーダ。
 * 根拠: .cursor/rules/TMS9995_instruction.mdc / asm_rules.mdc
 *
 * アドレスはバイト単位。命令語は 1〜3 ワード。
 * 構文は sdas 風（TI の `*R` / `@addr` / `>xxxx` は使わない）。
 */

import { evalExpr } from "../expression";
import type { ParsedLine, SymbolTable } from "../types";

/** 汎用アドレス（Ts/Td） */
export interface TmsGeneralAddr {
  /** 00=reg 01=(R) 10=symbolic/indexed 11=(R)+ */
  mode: number;
  reg: number;
  /** シンボリック / インデックス時の追加ワード */
  extraWord?: number;
}

/**
 * 式を評価して 16bit にする。
 * @param expr 式（sdas 数値。即値の `#` は含まない）
 * @param symbols シンボル
 * @param allowUndefined 未定義許可
 * @returns 16bit 値
 */
function evalTms(
  expr: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return evalExpr(expr, symbols, allowUndefined) & 0xffff;
}

/**
 * sdas 即値 `#n` を取る。
 * @param raw オペランド
 * @param symbols シンボル
 * @param allowUndefined 未定義許可
 * @param lineNo 行番号
 * @returns 16bit 即値
 */
function requireImm(
  raw: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
  lineNo: number,
): number {
  const s = raw.trim();
  if (!s.startsWith("#")) {
    throw new Error(
      `Line ${lineNo}: immediate requires '#' (sdas; got '${raw}')`,
    );
  }
  return evalTms(s.slice(1).trim(), symbols, allowUndefined);
}

/**
 * sdas 即値 `#n` を範囲付きで取る。
 * @param raw オペランド
 * @param lo 下限（含む）
 * @param hi 上限（含む）
 * @param symbols シンボル
 * @param allowUndefined 未定義許可
 * @param lineNo 行番号
 * @param what エラー用の名前
 * @returns 評価値
 */
function requireImmRange(
  raw: string,
  lo: number,
  hi: number,
  symbols: SymbolTable,
  allowUndefined: boolean,
  lineNo: number,
  what: string,
): number {
  const v = requireImm(raw, symbols, allowUndefined, lineNo);
  const s = (v << 16) >> 16;
  if (!allowUndefined && (s < lo || s > hi)) {
    throw new Error(`Line ${lineNo}: ${what} ${s} out of range (${lo}..${hi})`);
  }
  return allowUndefined ? 0 : s;
}

/**
 * ワークスペースレジスタ名を番号にする。
 * @param tok トークン
 * @returns 0–15。失敗時 undefined
 */
function parseReg(tok: string): number | undefined {
  const m = tok.trim().match(/^R([0-9]|1[0-5])$/i);
  if (!m) return undefined;
  return Number.parseInt(m[1]!, 10);
}

/**
 * 汎用アドレスオペランドを解析する。
 * @param raw - オペランド
 * @param symbols - シンボル
 * @param allowUndefined - 未定義許可
 * @param lineNo - 行番号
 * @return アドレス記述
 */
export function parseGeneralAddr(
  raw: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
  lineNo: number,
): TmsGeneralAddr {
  const s = raw.trim();
  if (!s) throw new Error(`Line ${lineNo}: empty addressing operand`);

  if (s.startsWith("#")) {
    throw new Error(
      `Line ${lineNo}: '#' is immediate-only (use LI/AI/…; got '${raw}')`,
    );
  }
  if (s.startsWith("@") || /^\*\s*R(?:[0-9]|1[0-5])/i.test(s)) {
    throw new Error(
      `Line ${lineNo}: TI syntax is not used (sdas: (Rn), (Rn)+, label, addr(Rn); got '${raw}')`,
    );
  }

  // (Rn)+ / [Rn]+
  let m = s.match(/^[(\[]\s*(R(?:[0-9]|1[0-5]))\s*[)\]]\s*\+$/i);
  if (m) {
    return { mode: 0b11, reg: parseReg(m[1]!)! };
  }
  // (Rn) / [Rn]
  m = s.match(/^[(\[]\s*(R(?:[0-9]|1[0-5]))\s*[)\]]\s*$/i);
  if (m) {
    return { mode: 0b01, reg: parseReg(m[1]!)! };
  }
  // Rn
  const regOnly = parseReg(s);
  if (regOnly !== undefined) {
    return { mode: 0b00, reg: regOnly };
  }
  // addr(Rn) / addr[Rn]
  m = s.match(/^(.+)\s*[(\[]\s*(R(?:[0-9]|1[0-5]))\s*[)\]]\s*$/i);
  if (m) {
    const r = parseReg(m[2]!)!;
    if (r === 0) {
      throw new Error(
        `Line ${lineNo}: indexed addressing cannot use R0 (use a label / address)`,
      );
    }
    return {
      mode: 0b10,
      reg: r,
      extraWord: evalTms(m[1]!.trim(), symbols, allowUndefined),
    };
  }
  // symbolic / 直接
  return {
    mode: 0b10,
    reg: 0,
    extraWord: evalTms(s, symbols, allowUndefined),
  };
}

/**
 * 汎用アドレスを命令語フィールドと追加ワードに展開する。
 * @param a - アドレス
 * @return { field6, extras }
 */
function packAddr(a: TmsGeneralAddr): {
  field6: number;
  extras: number[];
} {
  const field6 = ((a.mode & 3) << 4) | (a.reg & 0xf);
  const extras: number[] = [];
  if (a.extraWord !== undefined) extras.push(a.extraWord & 0xffff);
  return { field6, extras };
}

const FMT1: Record<string, number> = {
  SZC: 0x4000,
  SZCB: 0x5000,
  S: 0x6000,
  SB: 0x7000,
  C: 0x8000,
  CB: 0x9000,
  A: 0xa000,
  AB: 0xb000,
  MOV: 0xc000,
  MOVB: 0xd000,
  SOC: 0xe000,
  SOCB: 0xf000,
};

const FMT2_JUMP: Record<string, number> = {
  JMP: 0x1000,
  JLT: 0x1100,
  JLE: 0x1200,
  JEQ: 0x1300,
  JHE: 0x1400,
  JGT: 0x1500,
  JNE: 0x1600,
  JNC: 0x1700,
  JOC: 0x1800,
  JNO: 0x1900,
  JL: 0x1a00,
  JH: 0x1b00,
  JOP: 0x1c00,
};

const FMT6: Record<string, number> = {
  BLWP: 0x0400,
  B: 0x0440,
  X: 0x0480,
  CLR: 0x04c0,
  NEG: 0x0500,
  INV: 0x0540,
  INC: 0x0580,
  INCT: 0x05c0,
  DEC: 0x0600,
  DECT: 0x0640,
  BL: 0x0680,
  SWPB: 0x06c0,
  SETO: 0x0700,
  ABS: 0x0740,
  DIVS: 0x0180,
  MPYS: 0x01c0,
};

const FMT2_CRU: Record<string, number> = {
  SBO: 0x1d00,
  SBZ: 0x1e00,
  TB: 0x1f00,
};

const FMT3: Record<string, number> = {
  COC: 0x2000,
  CZC: 0x2400,
  XOR: 0x2800,
};

const FMT4: Record<string, number> = {
  LDCR: 0x3000,
  STCR: 0x3400,
};

const FMT5: Record<string, number> = {
  SRA: 0x0800,
  SRL: 0x0900,
  SLA: 0x0a00,
  SRC: 0x0b00,
};

const FMT8_REG_IMM: Record<string, number> = {
  LI: 0x0200,
  AI: 0x0220,
  ANDI: 0x0240,
  ORI: 0x0260,
  CI: 0x0280,
};

const FMT9: Record<string, number> = {
  XOP: 0x2c00,
  MPY: 0x3800,
  DIV: 0x3c00,
};

/** TMS9995 全命令（RT / NOP は別名） */
export const TMS9995_OPS = new Set<string>([
  ...Object.keys(FMT1),
  ...Object.keys(FMT2_JUMP),
  ...Object.keys(FMT2_CRU),
  ...Object.keys(FMT3),
  ...Object.keys(FMT4),
  ...Object.keys(FMT5),
  ...Object.keys(FMT6),
  ...Object.keys(FMT8_REG_IMM),
  ...Object.keys(FMT9),
  "LWPI",
  "LIMI",
  "STWP",
  "STST",
  "LST",
  "LWP",
  "RTWP",
  "IDLE",
  "RSET",
  "CKON",
  "CKOF",
  "LREX",
  "RT",
  "NOP",
]);

/**
 * TMS9995 命令が消費するバイト数を返す（pass1 用）。
 * @param line - 解析済み行
 * @return バイト数
 */
export function tms9995InstructionSize(line: ParsedLine): number {
  const words = encodeTms9995Instruction(line, 0, new Map(), true);
  return words.length * 2;
}

/**
 * TMS9995 命令をエンコードする。
 * @param line - 解析済み行
 * @param pcByte - 命令先頭のバイトアドレス
 * @param symbols - シンボル表（バイトアドレス）
 * @param allowUndefined - pass1 サイズ計算用
 * @return 命令語配列
 */
export function encodeTms9995Instruction(
  line: ParsedLine,
  pcByte: number,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number[] {
  if (!line.op) return [];
  let op = line.op.toUpperCase();
  const args = line.args.map((a) => a.trim());
  const lineNo = line.lineNo;

  // RT → B (R11)
  if (op === "RT") {
    if (args.length !== 0) {
      throw new Error(`Line ${lineNo}: RT takes no operands`);
    }
    return encodeTms9995Instruction(
      { ...line, op: "B", args: ["(R11)"] },
      pcByte,
      symbols,
      allowUndefined,
    );
  }

  // NOP → JMP $+0（次命令への相対 0）
  if (op === "NOP") {
    if (args.length !== 0) {
      throw new Error(`Line ${lineNo}: NOP takes no operands`);
    }
    return [0x1000];
  }

  // Format 7 fixed
  const FMT7_FIXED: Record<string, number> = {
    IDLE: 0x0340,
    RSET: 0x0360,
    RTWP: 0x0380,
    CKON: 0x03a0,
    CKOF: 0x03c0,
    LREX: 0x03e0,
  };
  if (op in FMT7_FIXED) {
    if (args.length !== 0)
      throw new Error(`Line ${lineNo}: ${op} takes no operands`);
    return [FMT7_FIXED[op]!];
  }

  // Format 8: LWPI / LIMI (imm only)
  if (op === "LWPI" || op === "LIMI") {
    if (args.length !== 1)
      throw new Error(`Line ${lineNo}: ${op} requires one immediate`);
    const base = op === "LWPI" ? 0x02e0 : 0x0300;
    return [base, requireImm(args[0]!, symbols, allowUndefined, lineNo)];
  }

  // Format 8: STWP / STST / LST / LWP (reg only)
  if (op === "STWP" || op === "STST" || op === "LST" || op === "LWP") {
    if (args.length !== 1)
      throw new Error(`Line ${lineNo}: ${op} requires one register`);
    const r = parseReg(args[0]!);
    if (r === undefined)
      throw new Error(`Line ${lineNo}: ${op} requires Rn`);
    const base =
      op === "STWP"
        ? 0x02a0
        : op === "STST"
          ? 0x02c0
          : op === "LST"
            ? 0x0080
            : 0x0090;
    return [base | (r & 0xf)];
  }

  // Format 8: LI / AI / ANDI / ORI / CI
  if (op in FMT8_REG_IMM) {
    if (args.length !== 2)
      throw new Error(`Line ${lineNo}: ${op} requires Rn, imm`);
    const r = parseReg(args[0]!);
    if (r === undefined)
      throw new Error(`Line ${lineNo}: ${op} first operand must be Rn`);
    const imm = requireImm(args[1]!, symbols, allowUndefined, lineNo);
    return [FMT8_REG_IMM[op]! | (r & 0xf), imm];
  }

  // Format 2: SBO / SBZ / TB（R12 相対の符号付き 8bit。ジャンプではない）
  if (op in FMT2_CRU) {
    if (args.length !== 1)
      throw new Error(`Line ${lineNo}: ${op} requires #disp`);
    const disp = requireImmRange(
      args[0]!,
      -128,
      127,
      symbols,
      allowUndefined,
      lineNo,
      `${op} displacement`,
    );
    return [FMT2_CRU[op]! | (disp & 0xff)];
  }

  // Format 2: jumps
  if (op in FMT2_JUMP) {
    if (args.length !== 1)
      throw new Error(`Line ${lineNo}: ${op} requires a label`);
    const target = evalTms(args[0]!, symbols, allowUndefined);
    // 相対は「次命令」からのワードオフセット
    const nextPc = pcByte + 2;
    const dispWords = allowUndefined
      ? 0
      : Math.trunc((target - nextPc) / 2);
    if (!allowUndefined && (target - nextPc) % 2 !== 0) {
      throw new Error(
        `Line ${lineNo}: jump target ${args[0]} is not word-aligned relative to PC`,
      );
    }
    if (!allowUndefined && (dispWords < -128 || dispWords > 127)) {
      throw new Error(
        `Line ${lineNo}: jump displacement ${dispWords} out of range (-128..127)`,
      );
    }
    return [FMT2_JUMP[op]! | (dispWords & 0xff)];
  }

  // Format 5: SRA / SRL / SLA / SRC  Rn, #count（0 は R0 下位 4bit）
  if (op in FMT5) {
    if (args.length !== 2)
      throw new Error(`Line ${lineNo}: ${op} requires Rn, #count`);
    const r = parseReg(args[0]!);
    if (r === undefined)
      throw new Error(`Line ${lineNo}: ${op} first operand must be Rn`);
    const cnt = requireImmRange(
      args[1]!,
      0,
      15,
      symbols,
      allowUndefined,
      lineNo,
      `${op} count`,
    );
    return [FMT5[op]! | ((cnt & 0xf) << 4) | (r & 0xf)];
  }

  // Format 3: COC / CZC / XOR  src, Rn
  if (op in FMT3) {
    if (args.length !== 2)
      throw new Error(`Line ${lineNo}: ${op} requires src, Rn`);
    const r = parseReg(args[1]!);
    if (r === undefined)
      throw new Error(`Line ${lineNo}: ${op} second operand must be Rn`);
    const src = parseGeneralAddr(args[0]!, symbols, allowUndefined, lineNo);
    const s = packAddr(src);
    return [FMT3[op]! | ((r & 0xf) << 6) | s.field6, ...s.extras];
  }

  // Format 4: LDCR / STCR  addr, #bits（0 と 16 は 16bit）
  if (op in FMT4) {
    if (args.length !== 2)
      throw new Error(`Line ${lineNo}: ${op} requires addr, #bits`);
    const bits = requireImmRange(
      args[1]!,
      0,
      16,
      symbols,
      allowUndefined,
      lineNo,
      `${op} bit count`,
    );
    if (!allowUndefined && bits > 16) {
      throw new Error(`Line ${lineNo}: ${op} bit count ${bits} out of range`);
    }
    const cccc = bits === 16 || bits === 0 ? 0 : bits;
    const src = parseGeneralAddr(args[0]!, symbols, allowUndefined, lineNo);
    const s = packAddr(src);
    return [FMT4[op]! | ((cccc & 0xf) << 6) | s.field6, ...s.extras];
  }

  // Format 9: XOP src, #n  /  MPY src, Rn  /  DIV src, Rn
  if (op in FMT9) {
    if (args.length !== 2)
      throw new Error(`Line ${lineNo}: ${op} requires two operands`);
    const src = parseGeneralAddr(args[0]!, symbols, allowUndefined, lineNo);
    const s = packAddr(src);
    if (op === "XOP") {
      const n = requireImmRange(
        args[1]!,
        0,
        15,
        symbols,
        allowUndefined,
        lineNo,
        "XOP number",
      );
      return [FMT9[op]! | ((n & 0xf) << 6) | s.field6, ...s.extras];
    }
    const r = parseReg(args[1]!);
    if (r === undefined)
      throw new Error(`Line ${lineNo}: ${op} second operand must be Rn`);
    return [FMT9[op]! | ((r & 0xf) << 6) | s.field6, ...s.extras];
  }

  // Format 6: single general operand（X / DIVS / MPYS 含む）
  if (op in FMT6) {
    if (args.length !== 1)
      throw new Error(`Line ${lineNo}: ${op} requires one operand`);
    const a = parseGeneralAddr(args[0]!, symbols, allowUndefined, lineNo);
    const { field6, extras } = packAddr(a);
    return [FMT6[op]! | field6, ...extras];
  }

  // Format 1: src, dst
  if (op in FMT1) {
    if (args.length !== 2)
      throw new Error(`Line ${lineNo}: ${op} requires src, dst`);
    const src = parseGeneralAddr(args[0]!, symbols, allowUndefined, lineNo);
    const dst = parseGeneralAddr(args[1]!, symbols, allowUndefined, lineNo);
    const s = packAddr(src);
    const d = packAddr(dst);
    // 追加ワード順: source extras first, then destination extras
    const word =
      FMT1[op]! |
      ((dst.mode & 3) << 10) |
      ((dst.reg & 0xf) << 6) |
      ((src.mode & 3) << 4) |
      (src.reg & 0xf);
    return [word, ...s.extras, ...d.extras];
  }

  throw new Error(
    `Line ${lineNo}: unknown TMS9995 opcode '${line.op}'`,
  );
}
