/**
 * MN1610 / MN1613 命令エンコーダ。
 * TMS9995 は `tms9995/tms9995_encode.ts`。
 */

import { evalExpr } from "../expression";
import type { CpuType, ParsedLine, SymbolTable } from "../types";

// ─── レジスタマップ ────────────────────────────────────────────────────────────

const REG_MAP = new Map<string, number>([
  ["R0", 0],
  ["R1", 1],
  ["R2", 2],
  ["R3", 3],
  ["X0", 3],
  ["R4", 4],
  ["X1", 4],
  ["SP", 5],
  ["STR", 6],
]);

const SKIP_MAP = new Map<string, number>([
  ["", 0],
  ["SKP", 1],
  ["M", 2],
  ["PZ", 3],
  ["Z", 4],
  ["E", 4],
  ["NZ", 5],
  ["NE", 5],
  ["MZ", 6],
  ["P", 7],
  ["EZ", 8],
  ["ENZ", 9],
  ["OZ", 10],
  ["ONZ", 11],
  ["LMZ", 12],
  ["LP", 13],
  ["LPZ", 14],
  ["LM", 15],
]);

const EM_MAP = new Map<string, number>([
  ["", 0],
  ["RE", 1],
  ["SE", 2],
  ["CE", 3],
]);

/** BB フィールド（ベースレジスタ） */
const BB_MAP = new Map<string, number>([
  ["CSBR", 0],
  ["SSBR", 1],
  ["TSR0", 2],
  ["TSR1", 3],
]);

/** bbb フィールド（ベースレジスタ + OSRx） */
const BBB_MAP = new Map<string, number>([
  ["CSBR", 0],
  ["SSBR", 1],
  ["TSR0", 2],
  ["TSR1", 3],
  ["OSR0", 4],
  ["OSR1", 5],
  ["OSR2", 6],
  ["OSR3", 7],
]);

/** ppp フィールド（特殊レジスタ） */
const PPP_MAP = new Map<string, number>([
  ["SBRB", 0],
  ["ICB", 1],
  ["NPP", 2],
]);

/** hhh フィールド（ハードウェア制御レジスタ） */
const HHH_MAP = new Map<string, number>([
  ["TCR", 0],
  ["TIR", 1],
  ["TSR", 2],
  ["SCR", 3],
  ["SSR", 4],
  ["SOR", 5],
  ["IISR", 6],
]);

/** ii フィールド（間接レジスタ R1〜R4） */
const II_MAP = new Map<string, number>([
  ["R1", 0],
  ["R2", 1],
  ["R3", 2],
  ["R4", 3],
]);

// ─── 2語命令セット（pass1 の PC カウント用） ──────────────────────────────────

/** MN1613 新設命令のニモニックセット（MN1610 モードでは使用不可） */
export const MN1613_ONLY_OPS = new Set<string>([
  // データ転送
  "LD",
  "STD",
  "LR",
  "STR",
  "MVWR",
  "MVWI",
  "MVBR",
  "BSWR",
  "DSWR",
  // スタック
  "PSHM",
  "POPM",
  // 整数演算
  "AWR",
  "AWI",
  "SWR",
  "SWI",
  "CWR",
  "CWI",
  "CBR",
  "CBI",
  "NEG",
  "AD",
  "SD",
  "M",
  "D",
  "DAA",
  "DAS",
  "LADR",
  "LADI",
  // 論理演算
  "ANDR",
  "ANDI",
  "ORR",
  "ORI",
  "EORR",
  "EORI",
  // 浮動小数点演算
  "FA",
  "FS",
  "FM",
  "FD",
  "FIX",
  "FLT",
  // 分岐
  "BD",
  "BL",
  "BR",
  "BALD",
  "BALL",
  "BALR",
  "RETL",
  // ビット操作
  "TSET",
  "TRST",
  "SRBT",
  "DEBP",
  // 特殊命令
  "BLK",
  "RDR",
  "WTR",
  // セグメントレジスタ転送
  "LB",
  "LS",
  "STB",
  "STS",
  "CPYB",
  "CPYS",
  "CPYH",
  "SETB",
  "SETS",
  "SETH",
]);

/** 常に2語を占める命令ニモニックのセット */
export const TWO_WORD_OPS = new Set<string>([
  // データ転送 (AD16)
  "LD",
  "STD",
  // 分岐 (AD16)
  "BD",
  "BL",
  "BALD",
  "BALL",
  // ビット操作 (AD16)
  "TSET",
  "TRST",
  // レジスタ転送 (AD16)
  "LB",
  "LS",
  "STB",
  "STS",
  // 即値演算 (IM16)
  "MVWI",
  "AWI",
  "SWI",
  "CWI",
  "CBI",
  "ANDI",
  "ORI",
  "EORI",
  "LADI",
]);

// ─── 検証ユーティリティ ────────────────────────────────────────────────────────

function u8(v: number, what: string): number {
  if (!Number.isInteger(v) || v < 0 || v > 0xff)
    throw new Error(`${what} out of 8-bit range: ${v}`);
  return v & 0xff;
}
function u4(v: number, what: string): number {
  if (v < 0 || v > 0xf) throw new Error(`${what} out of 4-bit range: ${v}`);
  return v & 0xf;
}
function u2(v: number, what: string): number {
  if (v < 0 || v > 0x3) throw new Error(`${what} out of 2-bit range: ${v}`);
  return v & 0x3;
}
function s8(v: number, what: string): number {
  if (v < -128 || v > 127)
    throw new Error(`${what} out of signed 8-bit range: ${v}`);
  return v & 0xff;
}

/**
 * 16bit に収まる値なら下位 16bit を返す。
 * 符号付き -32768〜32767 と符号なし 0〜65535 を認める。
 * @param v 評価値
 * @param what エラーメッセージ用の種別（IM16 / .dw など）
 * @returns 16bit 値
 * @throws 整数でない、または範囲外
 */
export function u16(v: number, what: string): number {
  if (!Number.isInteger(v) || v < -0x8000 || v > 0xffff) {
    throw new Error(`${what} out of 16-bit range: ${v}`);
  }
  return v & 0xffff;
}

// ─── パースヘルパー（MN1610共通） ─────────────────────────────────────────────

function parseReg(token: string, allowStr: boolean): number {
  const reg = REG_MAP.get(token.toUpperCase());
  if (reg === undefined) throw new Error(`Unknown register: ${token}`);
  if (!allowStr && reg === 6)
    throw new Error(`STR is not allowed here: ${token}`);
  return reg;
}
function parseSkip(token?: string): number {
  const key = (token ?? "").trim().toUpperCase();
  const v = SKIP_MAP.get(key);
  if (v === undefined) throw new Error(`Unknown skip condition: ${token}`);
  return v;
}
function parseEm(token?: string): number {
  const key = (token ?? "").trim().toUpperCase();
  const v = EM_MAP.get(key);
  if (v === undefined) throw new Error(`Unknown EM operation: ${token}`);
  return v;
}

/**
 * 即値オペランドから先頭の `#` を外す。`#` が無い場合はエラー。
 * 根拠: asm-rules.mdc（即値は必ず `#`。無い数値・ラベルはアドレス）。
 * @param arg オペランド文字列
 * @param what エラーメッセージ用の種別（I4 / I8 / IM16 など）
 * @returns `#` を除いた式
 */
function requireImmHash(arg: string, what: string): string {
  const t = arg.trim();
  if (!t.startsWith("#")) {
    throw new Error(
      `${what}: immediate operand requires '#' (got '${arg}')`,
    );
  }
  return t.slice(1).trim();
}

/**
 * `#` が付いていてはいけないオペランドから式を取る（LPSW の LL など）。
 * @param arg - オペランド文字列
 * @param what - エラーメッセージ用の種別
 * @returns `#` の無い式
 */
function forbidImmHash(arg: string, what: string): string {
  const t = arg.trim();
  if (t.startsWith("#")) {
    throw new Error(`${what} must not use '#' (got '${arg}')`);
  }
  return t;
}

/**
 * 4ビット即値を解析する。`#` 必須。
 * @param arg - 即値を表す文字列（例: "#5"）
 * @param symbols - シンボルテーブル
 * @param allowUndefined - 未定義シンボルを許可するかどうか
 * @return 解析された4ビット即値
 */
function parseImm4(
  arg: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return u4(
    evalExpr(requireImmHash(arg, "I4"), symbols, allowUndefined),
    "I4",
  );
}

/**
 * 8ビット即値を解析する。`#` 必須（MVI など）。
 * @param arg - 即値を表す文字列（例: "#200"）
 * @param symbols - シンボルテーブル
 * @param allowUndefined - 未定義シンボルを許可するかどうか
 * @return 解析された8ビット即値
 */
function parseImm8(
  arg: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return u8(
    evalExpr(requireImmHash(arg, "I8"), symbols, allowUndefined),
    "I8",
  );
}

/**
 * I/O ポート番号（RD / WT）を解析する。アドレス表記なので `#` は任意。
 * @param arg ポート番号（例: `HSHK_CTRL` / `#0x22`）
 * @param symbols シンボルテーブル
 * @param allowUndefined 未定義シンボルを許可するか
 * @returns 8bit ポート番号
 */
function parseIoAddr8(
  arg: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return u8(
    evalExpr(arg.replace(/^#/, "").trim(), symbols, allowUndefined),
    "I8",
  );
}

/**
 * 16ビット即値を解析する。`#` 必須（MVWI / AWI / ANDI など）。
 * @param arg 即値（例: `#0x1234` / `#HSHK_CMD_TIMER_SET`）
 * @param symbols シンボルテーブル
 * @param allowUndefined 未定義シンボルを許可するか
 * @returns 16bit 即値
 */
function parseImm16Value(
  arg: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return u16(
    evalExpr(requireImmHash(arg, "IM16"), symbols, allowUndefined),
    "IM16",
  );
}

/**
 * 16ビットアドレスを解析する。
 * `n` / `@n` / `(n)` を受理する（外側の @ () を除去）。`#` は即値専用なので付けない。
 */
function parseImm16(
  arg: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  return (
    evalExpr(stripAddrDecorators(arg), symbols, allowUndefined) & 0xffff
  );
}

/**
 * アドレス表記の外側装飾（@ / 対応する括弧）を除去する。
 * `#` は即値専用。アドレスに付いていたらエラー。
 * 例: "@VEC" → "VEC", "(0x100)" → "0x100"
 */
function stripAddrDecorators(arg: string): string {
  let t = arg.trim();
  if (t.startsWith("#")) {
    throw new Error(`address operand must not use '#' (got '${arg}')`);
  }
  if (t.startsWith("@")) t = t.slice(1).trim();
  if (t.startsWith("(") && t.endsWith(")")) t = t.slice(1, -1).trim();
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1).trim();
  return t;
}

/**
 * `addr(BRn)` 形式を解析する。一致しなければ null。
 */
function parseAddrWithBB(
  arg: string,
): { bb: number; addr: string } | null {
  const m = arg
    .trim()
    .match(/^(.+)\(\s*(CSBR|SSBR|TSR0|TSR1)\s*\)$/i);
  if (!m) return null;
  return { addr: m[1].trim(), bb: parseBB(m[2]) };
}

/**
 * アドレッシングモードを表すインターフェース
 */
interface EAMode {
  mmm: number;
  d8: number;
}

/**
 * アドレッシングモードを解析する。
 *
 * 推奨（sdas 風）と互換書式の両方を受理する。
 *   MMM=000 *D
 *   MMM=001 label（相対。d = ターゲット − 当該命令のワードアドレス）
 *   MMM=010 (*D)  / [*D]
 *   MMM=011 (label) / [label]
 *   MMM=100 D(X0) / D, X0
 *   MMM=101 D(X1) / D, X1
 *   MMM=110 (*D)(X0) / [*D], X0
 *   MMM=111 (*D)(X1) / [*D], X1
 */
function parseEA(
  arg: string,
  pcWord: number,
  symbols: SymbolTable,
  allowUndefined: boolean,
): EAMode {
  const t = arg.trim();
  let m: RegExpMatchArray | null;

  // (*D)(Xn) — 間接インデックス（sdas 風）。インデックスは X0/X1 のみ
  m = t.match(/^\(\s*\*(.+)\s*\)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    const idx = m[2]!.toUpperCase();
    if (idx !== "X0" && idx !== "X1") {
      throw new Error(
        `index register must be X0 or X1 (got '${m[2]}' in '${t}')`,
      );
    }
    return {
      mmm: idx === "X0" ? 0b110 : 0b111,
      d8: u8(evalExpr(m[1]!, symbols, allowUndefined), "EA"),
    };
  }
  // [*D], Xn — 間接インデックス（互換）
  m = t.match(/^\[\s*\*(.+)\s*\]\s*,\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (m) {
    const idx = m[2]!.toUpperCase();
    if (idx !== "X0" && idx !== "X1") {
      throw new Error(
        `index register must be X0 or X1 (got '${m[2]}' in '${t}')`,
      );
    }
    return {
      mmm: idx === "X0" ? 0b110 : 0b111,
      d8: u8(evalExpr(m[1]!, symbols, allowUndefined), "EA"),
    };
  }
  // D(Xn) — 直接インデックス（sdas 風）
  m = t.match(/^(.+)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    const idx = m[2]!.toUpperCase();
    if (idx !== "X0" && idx !== "X1") {
      throw new Error(
        `index register must be X0 or X1 (got '${m[2]}' in '${t}')`,
      );
    }
    return {
      mmm: idx === "X0" ? 0b100 : 0b101,
      d8: u8(evalExpr(m[1]!, symbols, allowUndefined), "EA"),
    };
  }
  // D, Xn — 直接インデックス（互換）
  m = t.match(/^(.+)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (m) {
    const idx = m[2]!.toUpperCase();
    // 「D, Rn」はインデックス専用。通常の「Rd, Rs」は別経路なのでここには来ない
    if (idx === "X0" || idx === "X1") {
      return {
        mmm: idx === "X0" ? 0b100 : 0b101,
        d8: u8(evalExpr(m[1]!, symbols, allowUndefined), "EA"),
      };
    }
  }
  // (*D) — ゼロページ間接（sdas 風）
  m = t.match(/^\(\s*\*(.+)\s*\)$/i);
  if (m) {
    return {
      mmm: 0b010,
      d8: u8(evalExpr(m[1], symbols, allowUndefined), "EA"),
    };
  }
  // [*D] — ゼロページ間接（互換）
  m = t.match(/^\[\s*\*(.+)\s*\]$/i);
  if (m) {
    return {
      mmm: 0b010,
      d8: u8(evalExpr(m[1], symbols, allowUndefined), "EA"),
    };
  }
  // (label) — 相対間接（sdas 風）
  m = t.match(/^\((.+)\)$/);
  if (m) {
    const rel = evalExpr(m[1], symbols, allowUndefined) - pcWord;
    return { mmm: 0b011, d8: s8(rel, "EA relative") };
  }
  // [label] — 相対間接（互換）
  m = t.match(/^\[(.+)\]$/);
  if (m) {
    const rel = evalExpr(m[1], symbols, allowUndefined) - pcWord;
    return { mmm: 0b011, d8: s8(rel, "EA relative") };
  }
  if (t.startsWith("*")) {
    return {
      mmm: 0b000,
      d8: u8(evalExpr(t.slice(1), symbols, allowUndefined), "EA"),
    };
  }
  const rel = evalExpr(t, symbols, allowUndefined) - pcWord;
  return { mmm: 0b001, d8: s8(rel, "EA relative") };
}

/**
 * 5ビットオペコード命令をエンコードする。
 * @param op - オペコード
 * @param ddd - 3ビットレジスタ指定
 * @param skip - 4ビットスキップ条件
 * @param tail - 4ビット末尾フィールド
 * @return エンコードされた命令ワード
 */
function op5(op: number, ddd: number, skip: number, tail: number): number {
  return (
    ((op & 0x1f) << 11) |
    ((ddd & 0x7) << 8) |
    ((skip & 0xf) << 4) |
    (tail & 0xf)
  );
}

/**
 * メモリアクセス命令をエンコードする。
 * @param bit1 - 1ビットフラグ
 * @param mmm - 3ビットアドレッシングモード
 * @param rrr - 3ビットレジスタ指定
 * @param d8 - 8ビット即値
 * @return エンコードされた命令ワード
 */
function encodeMem(bit1: number, mmm: number, rrr: number, d8: number): number {
  return (
    (1 << 15) |
    ((bit1 & 1) << 14) |
    ((mmm & 0x7) << 11) |
    ((rrr & 0x7) << 8) |
    (d8 & 0xff)
  );
}

/**
 * 指定された命令が2語命令かどうかを判定する。
 * @param line - 解析済み命令行
 * @param nMin - 最小引数数
 * @param nMax - 最大引数数（省略時は nMin と同じ）
 * @return 2語命令なら true、1語命令なら false
 */
function expectArgs(line: ParsedLine, nMin: number, nMax = nMin): void {
  if (line.args.length < nMin || line.args.length > nMax)
    throw new Error(
      `Line ${line.lineNo}: ${line.op} expects ${nMin}${nMax !== nMin ? `-${nMax}` : ""} args`,
    );
}

// ─── パースヘルパー（MN1613追加） ─────────────────────────────────────────────

/**
 * 4ビット即値を解析する。
 */
interface IndirectReg {
  ii: number;
  mm: number;
}

/**
 * 間接レジスタ指定を解析する。
 * "(Ri)", "-(Ri)", "(Ri)+", "@(Ri)" を受理する。
 */
function parseIndirect(arg: string): IndirectReg {
  const t = arg.trim();
  let m: RegExpMatchArray | null;

  m = t.match(/^-\(\s*(R[1-4])\s*\)$/i);
  if (m) {
    const ii = II_MAP.get(m[1].toUpperCase());
    if (ii === undefined) throw new Error(`Invalid indirect register: ${m[1]}`);
    return { ii, mm: 0b10 };
  }
  m = t.match(/^\(\s*(R[1-4])\s*\)\+$/i);
  if (m) {
    const ii = II_MAP.get(m[1].toUpperCase());
    if (ii === undefined) throw new Error(`Invalid indirect register: ${m[1]}`);
    return { ii, mm: 0b11 };
  }
  m = t.match(/^@?\(\s*(R[1-4])\s*\)$/i);
  if (m) {
    const ii = II_MAP.get(m[1].toUpperCase());
    if (ii === undefined) throw new Error(`Invalid indirect register: ${m[1]}`);
    return { ii, mm: 0b01 };
  }
  throw new Error(`Invalid indirect operand: ${arg}`);
}

/**
 * AD/SD/M/D の第1オペランドが DR0 であることを確認する。
 * @param arg オペランド
 */
function requireDr0(arg: string): void {
  if (arg.trim().toUpperCase() !== "DR0") {
    throw new Error(`First operand must be DR0 (got '${arg}')`);
  }
}

/**
 * AD/SD/M/D の第2オペランド。(R1)–(R4) のみ（自動増減なし）。
 * @param arg オペランド
 * @returns ii フィールド
 */
function parseDr0MemRi(arg: string): number {
  const indir = parseIndirect(arg);
  if (indir.mm !== 0b01) {
    throw new Error(`Second operand must be (R1)–(R4) (got '${arg}')`);
  }
  return indir.ii;
}

/**
 * ベースレジスタ指定を解析する。
 * @param token - ベースレジスタトークン
 * @return 解析結果の数値
 */
function parseBB(token: string): number {
  const v = BB_MAP.get(token.trim().toUpperCase());
  if (v === undefined) throw new Error(`Unknown base register: ${token}`);
  return v;
}

/**
 * 特殊レジスタ指定を解析する。
 * @param token - 特殊レジスタトークン
 * @return 解析結果の数値
 */
function parsePPP(token: string): number {
  const v = PPP_MAP.get(token.trim().toUpperCase());
  if (v === undefined) throw new Error(`Unknown special register: ${token}`);
  return v;
}

/**
 * ベースレジスタ指定を解析する。
 * @param token - ベースレジスタトークン
 * @param forWrite - 書き込み用フラグ
 * @return 解析結果の数値
 */
function parseBBB(token: string, forWrite = false): number {
  const v = BBB_MAP.get(token.trim().toUpperCase());
  if (v === undefined) throw new Error(`Unknown base register: ${token}`);
  if (forWrite && v === 0) throw new Error(`CSBR cannot be written directly`);
  return v;
}

/**
 * トークンが指定マップのレジスタ名か判定する。
 * @param map レジスタ名→番号
 * @param token オペランド
 * @returns マップにあれば true
 */
function isNamedReg(map: Map<string, number>, token: string): boolean {
  return map.has(token.trim().toUpperCase());
}

/**
 * CPYB/SETB 系で第1オペランドが特殊レジスタなら、正しい語順を示して落とす。
 * @param op ニモニック
 * @param form 正規のオペランド順（例: Rd, BRs）
 * @param writeOp 書き込み側ニモニック（CPYB なら SETB）
 * @param specialMap 第1オペランドに来てはいけないレジスタ表
 * @param args オペランド
 */
function rejectCopySetOrder(
  op: string,
  form: string,
  writeOp: string,
  specialMap: Map<string, number>,
  args: readonly string[],
): void {
  const a0 = args[0] ?? "";
  const a1 = args[1] ?? "";
  if (!isNamedReg(specialMap, a0)) return;
  const hint =
    op.startsWith("CPY") && writeOp !== op
      ? ` To write ${a0.trim()} use ${writeOp} ${a1.trim()}, ${a0.trim()}.`
      : ` Use ${writeOp} ${a1.trim()}, ${a0.trim()}.`;
  throw new Error(
    `${op} is ${form} (general register first). '${a0.trim()}' is not a general register.${hint}`,
  );
}

/**
 * ハードウェアレジスタ指定を解析する。
 * @param token - ハードウェアレジスタトークン
 * @return 解析結果の数値
 */
function parseHHH(token: string): number {
  const v = HHH_MAP.get(token.trim().toUpperCase());
  if (v === undefined) throw new Error(`Unknown hardware register: ${token}`);
  return v;
}

/** "C" トークンかどうか判定（キャリー指定） */
function isCarry(token: string): boolean {
  return token.trim().toUpperCase() === "C";
}

/**
 * [C][, Skip] の形式でキャリーとスキップを解析する。
 * @param args - 引数配列
 * @param startIdx - 解析開始インデックス
 */
function parseCarrySkip(
  args: string[],
  startIdx: number,
): { c: number; skip: number } {
  let c = 1; // デフォルト: キャリーなし
  let skip = 0;
  let i = startIdx;
  if (i < args.length && isCarry(args[i])) {
    c = 0;
    i++;
  }
  if (i < args.length) {
    skip = parseSkip(args[i]);
  }
  return { c, skip };
}

/**
 * 2語命令のLR/STR: R[, BRn], (Ri)[+/-] を解析して1語目を返す。
 * @param line - 解析済み命令行
 * @param op - "LR" または "STR"
 * @param indirBit - 間接ビット（0=LR, 4=STR）
 * @return エンコードされた1語目
 */
function encodeLRSTR(
  line: ParsedLine,
  op: string,
  indirBit: number, // 0=LR (00ii), 4=STR (01ii)
): number {
  expectArgs(line, 2, 3);
  let rrr: number, bb: number, indir: IndirectReg;
  if (line.args.length === 2) {
    rrr = parseReg(line.args[0], true);
    bb = 0;
    indir = parseIndirect(line.args[1]);
  } else {
    rrr = parseReg(line.args[0], true);
    bb = parseBB(line.args[1]);
    indir = parseIndirect(line.args[2]);
  }
  // 00100 RRR mmBB XX ii
  return (
    (0b00100 << 11) |
    (rrr << 8) |
    (indir.mm << 6) |
    (bb << 4) |
    indirBit |
    indir.ii
  );
}

/**
 * op5形式の命令で (Ri) 間接オペランドを取る場合の1語目を構築する。
 * 例: MVWR R0, (Ri)[, Skip] → op5(15, 7, skip, tailBase | ii)
 * @param line - 解析済み命令行
 * @param opcode5 - 5ビットオペコード
 * @param tailBase - tail の固定ビット (ii を除いた部分)
 * @param skipArgIdx - スキップ条件の引数インデックス
 * @param iiArgIdx - 間接レジスタの引数インデックス
 * @return エンコードされた1語目
 */
function encodeRindirect(
  line: ParsedLine,
  opcode5: number,
  tailBase: number, // tail の固定ビット (ii を除いた部分)
  skipArgIdx: number,
  iiArgIdx: number,
): number {
  const indir = parseIndirect(line.args[iiArgIdx]);
  const skip =
    skipArgIdx < line.args.length ? parseSkip(line.args[skipArgIdx]) : 0;
  return op5(opcode5, 7, skip, tailBase | indir.ii);
}

// ─── エンコード本体 ────────────────────────────────────────────────────────────

/**
 * 解析済み命令行を16bit命令語（1語または2語）にエンコードする。
 * @param line - 解析済み命令行
 * @param pcWord - 当該命令のワードアドレス（相対 EA の基準）
 * @param symbols - シンボルテーブル
 * @param allowUndefined - 未定義シンボルを許可するかどうか
 * @return 1語命令は [word]、2語命令は [word1, word2] を返す。
 */
export function encodeInstruction(
  line: ParsedLine,
  pcWord: number,
  symbols: SymbolTable,
  allowUndefined: boolean,
  cpuType: Exclude<CpuType, "tms9995"> = "mn1613",
): number[] {
  if (!line.op) throw new Error(`Line ${line.lineNo}: missing opcode`);
  const op = line.op.toUpperCase();

  // MN1610 モード時に MN1613 専用命令を使用した場合はエラー
  if (cpuType === "mn1610" && MN1613_ONLY_OPS.has(op)) {
    throw new Error(
      `Line ${line.lineNo}: '${line.op}' は MN1613 専用命令です（--cpu mn1610 モードでは使用できません）`,
    );
  }

  switch (op) {
    // ════════════════════════════════════════════════════════════════════════
    // MN1610 互換命令（1語）
    // ════════════════════════════════════════════════════════════════════════

    case "L": {
      expectArgs(line, 2, 3);
      const r = parseReg(line.args[0], false);
      const eaStr =
        line.args.length === 3
          ? `${line.args[1]}, ${line.args[2]}`
          : line.args[1];
      const ea = parseEA(eaStr, pcWord, symbols, allowUndefined);
      return [encodeMem(1, ea.mmm, r, ea.d8)];
    }
    case "ST": {
      expectArgs(line, 2, 3);
      const r = parseReg(line.args[0], false);
      const eaStr =
        line.args.length === 3
          ? `${line.args[1]}, ${line.args[2]}`
          : line.args[1];
      const ea = parseEA(eaStr, pcWord, symbols, allowUndefined);
      return [encodeMem(0, ea.mmm, r, ea.d8)];
    }
    case "B": {
      expectArgs(line, 1, 2);
      const eaStr =
        line.args.length === 2
          ? `${line.args[0]}, ${line.args[1]}`
          : line.args[0];
      const ea = parseEA(eaStr, pcWord, symbols, allowUndefined);
      return [encodeMem(1, ea.mmm, 0b111, ea.d8)];
    }
    case "BAL": {
      expectArgs(line, 1, 2);
      const eaStr =
        line.args.length === 2
          ? `${line.args[0]}, ${line.args[1]}`
          : line.args[0];
      const ea = parseEA(eaStr, pcWord, symbols, allowUndefined);
      return [encodeMem(0, ea.mmm, 0b111, ea.d8)];
    }
    case "IMS": {
      expectArgs(line, 1, 2);
      const eaStr =
        line.args.length === 2
          ? `${line.args[0]}, ${line.args[1]}`
          : line.args[0];
      const ea = parseEA(eaStr, pcWord, symbols, allowUndefined);
      return [encodeMem(1, ea.mmm, 0b110, ea.d8)];
    }
    case "DMS": {
      expectArgs(line, 1, 2);
      const eaStr =
        line.args.length === 2
          ? `${line.args[0]}, ${line.args[1]}`
          : line.args[0];
      const ea = parseEA(eaStr, pcWord, symbols, allowUndefined);
      return [encodeMem(0, ea.mmm, 0b110, ea.d8)];
    }

    case "A":
    case "S":
    case "C":
    case "CB":
    case "MV":
    case "MVB":
    case "BSWP":
    case "DSWP":
    case "LAD":
    case "AND":
    case "OR":
    case "EOR": {
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const rs = parseReg(line.args[1], true);
      const skip = parseSkip(line.args[2]);
      const def: Record<string, [number, number]> = {
        A: [0b01011, 0x8 | rs],
        S: [0b01011, 0x0 | rs],
        C: [0b01010, 0x8 | rs],
        CB: [0b01010, 0x0 | rs],
        MV: [0b01111, 0x8 | rs],
        MVB: [0b01111, 0x0 | rs],
        BSWP: [0b01110, 0x8 | rs],
        DSWP: [0b01110, 0x0 | rs],
        LAD: [0b01101, 0x0 | rs],
        AND: [0b01101, 0x8 | rs],
        OR: [0b01100, 0x8 | rs],
        EOR: [0b01100, 0x0 | rs],
      };
      const [o, tail] = def[op];
      return [op5(o, rd, skip, tail)];
    }

    case "SR":
    case "SL": {
      expectArgs(line, 1, 3);
      const r = parseReg(line.args[0], true);
      let em = 0,
        skip = 0;
      if (line.args.length === 2) {
        const maybeSkip = SKIP_MAP.get(line.args[1].toUpperCase());
        if (maybeSkip !== undefined) skip = maybeSkip;
        else em = parseEm(line.args[1]);
      }
      if (line.args.length === 3) {
        em = parseEm(line.args[1]);
        skip = parseSkip(line.args[2]);
      }
      const tailBase = op === "SR" ? 0b1000 : 0b1100;
      return [
        ((0b00100 << 11) | (r << 8) | (skip << 4) | (tailBase | em)) & 0xffff,
      ];
    }

    case "SBIT":
    case "RBIT":
    case "TBIT": {
      // ビット番号は MSB=0 / LSB=15（#15 が最下位 0x0001。IISR 未定義フラグと同じ）
      expectArgs(line, 2, 3);
      const r = parseReg(line.args[0], true);
      const i4 = parseImm4(line.args[1], symbols, allowUndefined);
      const skip = parseSkip(line.args[2]);
      const oMap: Record<string, number> = {
        TBIT: 0b00101,
        RBIT: 0b00110,
        SBIT: 0b00111,
      };
      return [((oMap[op] << 11) | (r << 8) | (skip << 4) | i4) & 0xffff];
    }

    case "AI":
    case "SI": {
      expectArgs(line, 2, 3);
      const r = parseReg(line.args[0], true);
      const i4 = parseImm4(line.args[1], symbols, allowUndefined);
      const skip = parseSkip(line.args[2]);
      return [
        (((op === "AI" ? 0b01001 : 0b01000) << 11) |
          (r << 8) |
          (skip << 4) |
          i4) &
          0xffff,
      ];
    }

    case "LPSW": {
      expectArgs(line, 1);
      const ll = u2(
        evalExpr(
          forbidImmHash(line.args[0]!, "LPSW level"),
          symbols,
          allowUndefined,
        ),
        "LPSW level",
      );
      return [((0b00100 << 11) | 0x04 | ll) & 0xffff];
    }
    case "H": {
      expectArgs(line, 0);
      return [0x2000];
    }
    case "PUSH": {
      expectArgs(line, 1);
      const r = parseReg(line.args[0], true);
      return [((0b00100 << 11) | (r << 8) | 0x0001) & 0xffff];
    }
    case "POP": {
      expectArgs(line, 1);
      const r = parseReg(line.args[0], true);
      return [((0b00100 << 11) | (r << 8) | 0x0002) & 0xffff];
    }
    case "RET": {
      expectArgs(line, 0);
      return [((0b00100 << 11) | 0x0003) & 0xffff];
    }

    case "RD": {
      expectArgs(line, 2);
      const r = parseReg(line.args[0], true);
      return [
        ((0b00011 << 11) |
          (r << 8) |
          parseIoAddr8(line.args[1], symbols, allowUndefined)) &
          0xffff,
      ];
    }
    case "WT": {
      expectArgs(line, 2);
      const r = parseReg(line.args[0], true);
      return [
        ((0b00010 << 11) |
          (r << 8) |
          parseIoAddr8(line.args[1], symbols, allowUndefined)) &
          0xffff,
      ];
    }
    case "MVI": {
      expectArgs(line, 2);
      const r = parseReg(line.args[0], true);
      return [
        ((0b00001 << 11) |
          (r << 8) |
          parseImm8(line.args[1], symbols, allowUndefined)) &
          0xffff,
      ];
    }

    // ════════════════════════════════════════════════════════════════════════
    // MN1613 新設命令
    // ════════════════════════════════════════════════════════════════════════

    // ── データ転送 (2語) ─────────────────────────────────────────────────

    case "LD": {
      // LD R[, BRn], Exp  →  00100 111 00BB 1RRR | AD16
      // LD R, Exp(BRn) も受理
      expectArgs(line, 2, 3);
      let rrr: number, bb: number, ad16: number;
      if (line.args.length === 2) {
        rrr = parseReg(line.args[0], false);
        const withBb = parseAddrWithBB(line.args[1]);
        if (withBb) {
          bb = withBb.bb;
          ad16 = parseImm16(withBb.addr, symbols, allowUndefined);
        } else {
          bb = 0;
          ad16 = parseImm16(line.args[1], symbols, allowUndefined);
        }
      } else {
        rrr = parseReg(line.args[0], false);
        bb = parseBB(line.args[1]);
        ad16 = parseImm16(line.args[2], symbols, allowUndefined);
      }
      return [0x2700 | (bb << 4) | 0x08 | rrr, ad16];
    }

    case "STD": {
      // STD R[, BRn], Exp  →  00100 111 01BB 1RRR | AD16
      // STD R, Exp(BRn) も受理
      expectArgs(line, 2, 3);
      let rrr: number, bb: number, ad16: number;
      if (line.args.length === 2) {
        rrr = parseReg(line.args[0], false);
        const withBb = parseAddrWithBB(line.args[1]);
        if (withBb) {
          bb = withBb.bb;
          ad16 = parseImm16(withBb.addr, symbols, allowUndefined);
        } else {
          bb = 0;
          ad16 = parseImm16(line.args[1], symbols, allowUndefined);
        }
      } else {
        rrr = parseReg(line.args[0], false);
        bb = parseBB(line.args[1]);
        ad16 = parseImm16(line.args[2], symbols, allowUndefined);
      }
      return [0x2700 | 0x40 | (bb << 4) | 0x08 | rrr, ad16];
    }

    case "LR": {
      // LR R[, BRn], (Ri)[+/-]  →  00100 RRR mmBB 00ii
      return [encodeLRSTR(line, op, 0x00)];
    }

    case "STR": {
      // STR R[, BRn], (Ri)[+/-]  →  00100 RRR mmBB 01ii
      // (注意: "STR" はレジスタ名とニモニックが同じだが、オペコードとして使用)
      return [encodeLRSTR(line, op, 0x04)];
    }

    // ── データ転送 (1語、レジスタ間接) ───────────────────────────────────

    case "MVWR": {
      // MVWR R0, (Ri)[, Skip]  →  01111 111 kkkk 10ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01111, 0x08, 2, 1)];
    }
    case "MVWI": {
      // MVWI Rd, Exp[, Skip]  →  01111 ddd kkkk 0111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      const im16 = parseImm16Value(line.args[1], symbols, allowUndefined);
      return [op5(0b01111, rd, skip, 0x07), im16];
    }
    case "MVBR": {
      // MVBR R0, (Ri)[, Skip]  →  01111 111 kkkk 00ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01111, 0x00, 2, 1)];
    }
    case "BSWR": {
      // BSWR R0, (Ri)[, Skip]  →  01110 111 kkkk 10ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01110, 0x08, 2, 1)];
    }
    case "DSWR": {
      // DSWR R0, (Ri)[, Skip]  →  01110 111 kkkk 00ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01110, 0x00, 2, 1)];
    }

    // ── スタック ─────────────────────────────────────────────────────────

    case "PSHM": {
      // PSHM  →  00010 111 0000 1111 = 0x170F
      expectArgs(line, 0);
      return [0x170f];
    }
    case "POPM": {
      // POPM  →  00010 111 0000 0111 = 0x1707
      expectArgs(line, 0);
      return [0x1707];
    }

    // ── 整数演算 (1語、レジスタ間接) ─────────────────────────────────────

    case "AWR": {
      // AWR R0, (Ri)[, Skip]  →  01011 111 kkkk 10ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01011, 0x08, 2, 1)];
    }
    case "AWI": {
      // AWI Rd, Exp[, Skip]  →  01011 ddd kkkk 1111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01011, rd, skip, 0x0f),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }
    case "SWR": {
      // SWR R0, (Ri)[, Skip]  →  01011 111 kkkk 00ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01011, 0x00, 2, 1)];
    }
    case "SWI": {
      // SWI Rd, Exp[, Skip]  →  01011 ddd kkkk 0111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01011, rd, skip, 0x07),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }
    case "CWR": {
      // CWR R0, (Ri)[, Skip]  →  01010 111 kkkk 10ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01010, 0x08, 2, 1)];
    }
    case "CWI": {
      // CWI Rd, Exp[, Skip]  →  01010 ddd kkkk 1111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01010, rd, skip, 0x0f),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }
    case "CBR": {
      // CBR R0, (Ri)[, Skip]  →  01010 111 kkkk 00ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01010, 0x00, 2, 1)];
    }
    case "CBI": {
      // CBI Rd, Exp[, Skip]  →  01010 ddd kkkk 0111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01010, rd, skip, 0x07),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }

    case "NEG": {
      // NEG Rd[, C][, Skip]  →  00011 111 kkkk cddd
      expectArgs(line, 1, 3);
      const rd = parseReg(line.args[0], true);
      const { c, skip } = parseCarrySkip(line.args, 1);
      return [(0b00011 << 11) | (7 << 8) | (skip << 4) | (c << 3) | rd];
    }

    case "AD": {
      // AD DR0, (Ri)[, C][, Skip]  →  01001 111 kkkk c1ii
      expectArgs(line, 2, 4);
      requireDr0(line.args[0]);
      const ii = parseDr0MemRi(line.args[1]);
      const { c, skip } = parseCarrySkip(line.args, 2);
      return [op5(0b01001, 7, skip, (c << 3) | 0x04 | ii)];
    }
    case "SD": {
      // SD DR0, (Ri)[, C][, Skip]  →  01000 111 kkkk c1ii
      expectArgs(line, 2, 4);
      requireDr0(line.args[0]);
      const ii = parseDr0MemRi(line.args[1]);
      const { c, skip } = parseCarrySkip(line.args, 2);
      return [op5(0b01000, 7, skip, (c << 3) | 0x04 | ii)];
    }
    case "M": {
      // M DR0, (Ri)[, Skip]  →  01111 111 kkkk 11ii
      expectArgs(line, 2, 3);
      requireDr0(line.args[0]);
      const ii = parseDr0MemRi(line.args[1]);
      const skip =
        line.args.length > 2 ? parseSkip(line.args[2]) : 0;
      return [op5(0b01111, 7, skip, 0x0c | ii)];
    }
    case "D": {
      // D DR0, (Ri)[, Skip]  →  01110 111 kkkk 11ii
      expectArgs(line, 2, 3);
      requireDr0(line.args[0]);
      const ii = parseDr0MemRi(line.args[1]);
      const skip =
        line.args.length > 2 ? parseSkip(line.args[2]) : 0;
      return [op5(0b01110, 7, skip, 0x0c | ii)];
    }
    case "DAA": {
      // DAA R0, (Ri)[, C][, Skip]  →  01011 111 kkkk c1ii
      expectArgs(line, 2, 4);
      const indir = parseIndirect(line.args[1]);
      const { c, skip } = parseCarrySkip(line.args, 2);
      return [op5(0b01011, 7, skip, (c << 3) | 0x04 | indir.ii)];
    }
    case "DAS": {
      // DAS R0, (Ri)[, C][, Skip]  →  01010 111 kkkk c1ii
      expectArgs(line, 2, 4);
      const indir = parseIndirect(line.args[1]);
      const { c, skip } = parseCarrySkip(line.args, 2);
      return [op5(0b01010, 7, skip, (c << 3) | 0x04 | indir.ii)];
    }

    case "LADR": {
      // LADR R0, (Ri)[, Skip]  →  01101 111 kkkk 00ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01101, 0x00, 2, 1)];
    }
    case "LADI": {
      // LADI Rd, Exp[, Skip]  →  01101 ddd kkkk 0111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01101, rd, skip, 0x07),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }

    // ── 論理演算 (レジスタ間接・即値) ─────────────────────────────────────

    case "ANDR": {
      // ANDR R0, (Ri)[, Skip]  →  01101 111 kkkk 10ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01101, 0x08, 2, 1)];
    }
    case "ANDI": {
      // ANDI Rd, Exp[, Skip]  →  01101 ddd kkkk 1111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01101, rd, skip, 0x0f),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }
    case "ORR": {
      // ORR R0, (Ri)[, Skip]  →  01100 111 kkkk 10ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01100, 0x08, 2, 1)];
    }
    case "ORI": {
      // ORI Rd, Exp[, Skip]  →  01100 ddd kkkk 1111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01100, rd, skip, 0x0f),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }
    case "EORR": {
      // EORR R0, (Ri)[, Skip]  →  01100 111 kkkk 00ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01100, 0x00, 2, 1)];
    }
    case "EORI": {
      // EORI Rd, Exp[, Skip]  →  01100 ddd kkkk 0111 | IM16
      expectArgs(line, 2, 3);
      const rd = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      return [
        op5(0b01100, rd, skip, 0x07),
        parseImm16Value(line.args[1], symbols, allowUndefined),
      ];
    }

    // ── 浮動小数点演算 ────────────────────────────────────────────────────

    case "FA": {
      // FA DR0, (Ri)[, Skip]  →  01101 111 kkkk 11ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01101, 0x0c, 2, 1)];
    }
    case "FS": {
      // FS DR0, (Ri)[, Skip]  →  01101 111 kkkk 01ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01101, 0x04, 2, 1)];
    }
    case "FM": {
      // FM DR0, (Ri)[, Skip]  →  01100 111 kkkk 11ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01100, 0x0c, 2, 1)];
    }
    case "FD": {
      // FD DR0, (Ri)[, Skip]  →  01100 111 kkkk 01ii
      expectArgs(line, 2, 3);
      return [encodeRindirect(line, 0b01100, 0x04, 2, 1)];
    }
    case "FIX": {
      // FIX R0, DR0[, Skip]  →  00011 111 kkkk 0100
      expectArgs(line, 2, 3);
      const skip = parseSkip(line.args[2]);
      return [(0b00011 << 11) | (7 << 8) | (skip << 4) | 0x04];
    }
    case "FLT": {
      // FLT DR0, R0[, Skip]  →  00011 111 kkkk 1100
      expectArgs(line, 2, 3);
      const skip = parseSkip(line.args[2]);
      return [(0b00011 << 11) | (7 << 8) | (skip << 4) | 0x0c];
    }

    // ── 分岐 (2語) ────────────────────────────────────────────────────────

    case "BD": {
      // BD Exp  →  00100 110 0000 0111 | AD16
      expectArgs(line, 1);
      return [0x2607, parseImm16(line.args[0], symbols, allowUndefined)];
    }
    case "BL": {
      // BL (Exp)  →  00100 111 0000 1111 | AD16
      expectArgs(line, 1);
      return [0x270f, parseImm16(line.args[0], symbols, allowUndefined)];
    }
    case "BR": {
      // BR (Ri)  →  00100 111 0000 01ii
      expectArgs(line, 1);
      const indir = parseIndirect(line.args[0]);
      return [(0b00100 << 11) | (7 << 8) | 0x04 | indir.ii];
    }
    case "BALD": {
      // BALD Exp  →  00100 110 0001 0111 | AD16
      expectArgs(line, 1);
      return [0x2617, parseImm16(line.args[0], symbols, allowUndefined)];
    }
    case "BALL": {
      // BALL (Exp)  →  00100 111 0001 1111 | AD16
      expectArgs(line, 1);
      return [0x271f, parseImm16(line.args[0], symbols, allowUndefined)];
    }
    case "BALR": {
      // BALR (Ri)  →  00100 111 0001 01ii
      expectArgs(line, 1);
      const indir = parseIndirect(line.args[0]);
      return [(0b00100 << 11) | (7 << 8) | 0x14 | indir.ii];
    }
    case "RETL": {
      // RETL  →  00111 111 0000 0111 = 0x3F07
      expectArgs(line, 0);
      return [0x3f07];
    }

    // ── ビット操作（MN1613新設） ──────────────────────────────────────────

    case "TSET": {
      // TSET Rs, Exp[, Skip]  →  00010 111 kkkk 1sss | AD16
      expectArgs(line, 2, 3);
      const rs = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      const ad16 = parseImm16(line.args[1], symbols, allowUndefined);
      return [(0b00010 << 11) | (7 << 8) | (skip << 4) | 0x08 | rs, ad16];
    }
    case "TRST": {
      // TRST Rs, Exp[, Skip]  →  00010 111 kkkk 0sss | AD16
      expectArgs(line, 2, 3);
      const rs = parseReg(line.args[0], true);
      const skip = parseSkip(line.args[2]);
      const ad16 = parseImm16(line.args[1], symbols, allowUndefined);
      return [(0b00010 << 11) | (7 << 8) | (skip << 4) | rs, ad16];
    }
    case "SRBT": {
      // SRBT R0, Rs  →  00111 111 0111 0sss
      expectArgs(line, 2);
      const rs = parseReg(line.args[1], true);
      return [0x3f70 | rs];
    }
    case "DEBP": {
      // DEBP Rd, R0  →  00111 111 1111 0ddd
      expectArgs(line, 2);
      const rd = parseReg(line.args[0], true);
      return [0x3ff0 | rd];
    }

    // ── 特殊命令 ─────────────────────────────────────────────────────────

    case "BLK": {
      // BLK  →  00111 111 0001 0111 = 0x3F17
      expectArgs(line, 0);
      return [0x3f17];
    }
    case "RDR": {
      // RDR R, (Ri)  →  00100 rrr 0001 01ii
      expectArgs(line, 2);
      const r = parseReg(line.args[0], true);
      const indir = parseIndirect(line.args[1]);
      return [(0b00100 << 11) | (r << 8) | 0x14 | indir.ii];
    }
    case "WTR": {
      // WTR R, (Ri)  →  00100 rrr 0001 00ii
      expectArgs(line, 2);
      const r = parseReg(line.args[0], true);
      const indir = parseIndirect(line.args[1]);
      return [(0b00100 << 11) | (r << 8) | 0x10 | indir.ii];
    }

    // ── レジスタ転送（2語: セグメントベース・特殊・HW制御） ───────────────

    case "LB": {
      // LB BRd, Exp  →  00001 111 0bbb 0111 | AD16
      expectArgs(line, 2);
      const bbb = parseBBB(line.args[0]);
      return [
        0x0f00 | (bbb << 4) | 0x07,
        parseImm16(line.args[1], symbols, allowUndefined),
      ];
    }
    case "LS": {
      // LS SRd, Exp  →  00001 111 0ppp 1111 | AD16
      expectArgs(line, 2);
      const ppp = parsePPP(line.args[0]);
      return [
        0x0f00 | (ppp << 4) | 0x0f,
        parseImm16(line.args[1], symbols, allowUndefined),
      ];
    }
    case "STB": {
      // STB BRs, Exp  →  00001 111 1bbb 0111 | AD16
      expectArgs(line, 2);
      const bbb = parseBBB(line.args[0], true);
      return [
        0x0f00 | 0x80 | (bbb << 4) | 0x07,
        parseImm16(line.args[1], symbols, allowUndefined),
      ];
    }
    case "STS": {
      // STS SRs, Exp  →  00001 111 1ppp 1111 | AD16
      expectArgs(line, 2);
      const ppp = parsePPP(line.args[0]);
      return [
        0x0f00 | 0x80 | (ppp << 4) | 0x0f,
        parseImm16(line.args[1], symbols, allowUndefined),
      ];
    }
    case "CPYB": {
      // CPYB Rd, BRs  →  00001 111 1bbb 0ddd
      expectArgs(line, 2);
      rejectCopySetOrder("CPYB", "Rd, BRs", "SETB", BBB_MAP, line.args);
      const rd = parseReg(line.args[0], true);
      const bbb = parseBBB(line.args[1]);
      return [0x0f00 | 0x80 | (bbb << 4) | rd];
    }
    case "CPYS": {
      // CPYS Rd, SRs  →  00001 111 1ppp 1ddd
      expectArgs(line, 2);
      rejectCopySetOrder("CPYS", "Rd, SRs", "SETS", PPP_MAP, line.args);
      const rd = parseReg(line.args[0], true);
      const ppp = parsePPP(line.args[1]);
      return [0x0f00 | 0x80 | (ppp << 4) | 0x08 | rd];
    }
    case "CPYH": {
      // CPYH Rd, HRs  →  00111 111 1hhh 0ddd
      expectArgs(line, 2);
      rejectCopySetOrder("CPYH", "Rd, HRs", "SETH", HHH_MAP, line.args);
      const rd = parseReg(line.args[0], true);
      const hhh = parseHHH(line.args[1]);
      return [0x3f00 | 0x80 | (hhh << 4) | rd];
    }
    case "SETB": {
      // SETB Rs, BRd  →  00001 111 0bbb 0sss
      expectArgs(line, 2);
      rejectCopySetOrder("SETB", "Rs, BRd", "SETB", BBB_MAP, line.args);
      const rs = parseReg(line.args[0], true);
      const bbb = parseBBB(line.args[1], true);
      return [0x0f00 | (bbb << 4) | rs];
    }
    case "SETS": {
      // SETS Rs, SRd  →  00001 111 0ppp 1sss
      expectArgs(line, 2);
      rejectCopySetOrder("SETS", "Rs, SRd", "SETS", PPP_MAP, line.args);
      const rs = parseReg(line.args[0], true);
      const ppp = parsePPP(line.args[1]);
      return [0x0f00 | (ppp << 4) | 0x08 | rs];
    }
    case "SETH": {
      // SETH Rs, HRd  →  00111 111 0hhh 0sss
      expectArgs(line, 2);
      rejectCopySetOrder("SETH", "Rs, HRd", "SETH", HHH_MAP, line.args);
      const rs = parseReg(line.args[0], true);
      const hhh = parseHHH(line.args[1]);
      return [0x3f00 | (hhh << 4) | rs];
    }

    default:
      throw new Error(`Line ${line.lineNo}: Unsupported opcode '${line.op}'`);
  }
}
