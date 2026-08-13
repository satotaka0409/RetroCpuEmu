/**
 * TMS9995 命令エンコーダ（第1弾）。
 * 根拠: .cursor/rules/TMS9995_instruction.mdc
 *
 * アドレスはバイト単位。命令語は 1〜3 ワード。
 */

import { evalExpr } from "./expression";
import type { ParsedLine, SymbolTable } from "./types";

/** 汎用アドレス（Ts/Td） */
export interface TmsGeneralAddr {
  /** 00=reg 01=*R 10=@ / @() 11=*R+ */
  mode: number;
  reg: number;
  /** シンボリック / インデックス時の追加ワード */
  extraWord?: number;
}

/**
 * TI 風 `>xxxx` を `0xxxxx` に正規化する。
 * @param expr - 式
 * @return 正規化後
 */
function normalizeTmsExpr(expr: string): string {
  return expr.replace(/>\s*([0-9A-Fa-f]+)\b/g, "0x$1");
}

/**
 * 式を評価する（`>` 16進対応）。
 * @param expr - 式
 * @param symbols - シンボル
 * @param allowUndefined - 未定義許可
 * @return 値
 */
function evalTms(
  expr: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return evalExpr(normalizeTmsExpr(expr), symbols, allowUndefined) & 0xffff;
}

/**
 * ワークスペースレジスタ名を番号にする。
 * @param tok - トークン
 * @return 0–15。失敗時 undefined
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

  // *Rn+
  let m = s.match(/^\*\s*(R(?:[0-9]|1[0-5]))\s*\+$/i);
  if (m) {
    return { mode: 0b11, reg: parseReg(m[1]!)! };
  }
  // *Rn
  m = s.match(/^\*\s*(R(?:[0-9]|1[0-5]))\s*$/i);
  if (m) {
    return { mode: 0b01, reg: parseReg(m[1]!)! };
  }
  // Rn
  const regOnly = parseReg(s);
  if (regOnly !== undefined) {
    return { mode: 0b00, reg: regOnly };
  }
  // @addr(Rn)
  m = s.match(/^@\s*(.+)\(\s*(R(?:[0-9]|1[0-5]))\s*\)\s*$/i);
  if (m) {
    const r = parseReg(m[2]!)!;
    if (r === 0) {
      throw new Error(
        `Line ${lineNo}: indexed addressing cannot use R0 (use @addr)`,
      );
    }
    return {
      mode: 0b10,
      reg: r,
      extraWord: evalTms(m[1]!, symbols, allowUndefined),
    };
  }
  // @addr
  m = s.match(/^@\s*(.+)\s*$/);
  if (m) {
    return {
      mode: 0b10,
      reg: 0,
      extraWord: evalTms(m[1]!, symbols, allowUndefined),
    };
  }

  throw new Error(`Line ${lineNo}: invalid TMS9995 address '${raw}'`);
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

const FMT8_REG_IMM: Record<string, number> = {
  LI: 0x0200,
  AI: 0x0220,
  ANDI: 0x0240,
  ORI: 0x0260,
  CI: 0x0280,
};

/** 第1弾でサポートするニーモニック */
export const TMS9995_OPS = new Set<string>([
  ...Object.keys(FMT1),
  ...Object.keys(FMT2_JUMP),
  ...Object.keys(FMT6).filter((k) => k !== "DIVS" && k !== "MPYS" && k !== "X"),
  ...Object.keys(FMT8_REG_IMM),
  "LWPI",
  "LIMI",
  "STWP",
  "STST",
  "LST",
  "LWP",
  "RTWP",
  "RT",
  "IDLE",
  "RSET",
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

  // RT → B *R11
  if (op === "RT") {
    if (args.length !== 0) {
      throw new Error(`Line ${lineNo}: RT takes no operands`);
    }
    return encodeTms9995Instruction(
      { ...line, op: "B", args: ["*R11"] },
      pcByte,
      symbols,
      allowUndefined,
    );
  }

  // Format 7 fixed
  if (op === "RTWP") {
    if (args.length !== 0)
      throw new Error(`Line ${lineNo}: RTWP takes no operands`);
    return [0x0380];
  }
  if (op === "IDLE") {
    if (args.length !== 0)
      throw new Error(`Line ${lineNo}: IDLE takes no operands`);
    return [0x0340];
  }
  if (op === "RSET") {
    if (args.length !== 0)
      throw new Error(`Line ${lineNo}: RSET takes no operands`);
    return [0x0360];
  }

  // Format 8: LWPI / LIMI (imm only)
  if (op === "LWPI" || op === "LIMI") {
    if (args.length !== 1)
      throw new Error(`Line ${lineNo}: ${op} requires one immediate`);
    const base = op === "LWPI" ? 0x02e0 : 0x0300;
    return [base, evalTms(args[0]!, symbols, allowUndefined)];
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
    const imm = evalTms(args[1]!, symbols, allowUndefined);
    return [FMT8_REG_IMM[op]! | (r & 0xf), imm];
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

  // Format 6: single general operand
  if (op in FMT6 && op !== "DIVS" && op !== "MPYS" && op !== "X") {
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
    `Line ${lineNo}: unsupported TMS9995 opcode '${line.op}' (phase-1 subset)`,
  );
}
