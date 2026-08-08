import type { RelocOperand, SymbolInfoTable, SymbolTable } from "./types";

/**
 * シンボル名をリロケーションオペランドに変換する。
 * external → symbol、定義済み（local/global）→ word。
 * @param name - 大文字シンボル名
 * @param symbolInfos - シンボル情報表
 * @return オペランド。未知シンボルなら null
 */
function toRelocOperand(
  name: string,
  symbolInfos: SymbolInfoTable,
): RelocOperand | null {
  const info = symbolInfos.get(name);
  if (!info) return null;
  if (info.kind === "external") {
    return { kind: "symbol", name };
  }
  return {
    kind: "word",
    value: info.value & 0xffff,
    area: info.area ? info.area.trim().toUpperCase() : undefined,
  };
}

/**
 * 16bit アドレス／即値オペランドから単純シンボル名を取り出す。
 * @param expr - オペランド（`FOO` / `#FOO` / `@FOO` / `(FOO)`）
 * @return 大文字シンボル名。単純でなければ null
 */
export function parseSimpleSymbolOperand(expr: string): string | null {
  let t: string = expr.trim();
  if (t.startsWith("#")) t = t.slice(1).trim();
  if (t.startsWith("@")) t = t.slice(1).trim();
  if (
    (t.startsWith("(") && t.endsWith(")")) ||
    (t.startsWith("[") && t.endsWith("]"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (!/^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(t)) return null;
  return t.toUpperCase();
}

/**
 * 単一の外部シンボル（アドレス、または `#SYM` 即値）を検出する。
 * リンク時に絶対ワードアドレスを埋める W レコード（`SYM-=0000`）用。
 * @param expr - オペランド文字列
 * @param symbolInfos - シンボル情報表
 * @return 大文字シンボル名。該当しなければ null
 */
export function matchExternalAbsReloc(
  expr: string,
  symbolInfos: SymbolInfoTable,
): string | null {
  const name = parseSimpleSymbolOperand(expr);
  if (!name) return null;
  const info = symbolInfos.get(name);
  if (info?.kind !== "external") return null;
  return name;
}

/**
 * リンク後の絶対ワードアドレスが必要な 16bit オペランドを検出する。
 * - external / global: Def 名で解決（`SYM-=0000`）
 * - local かつ `_CODE` / `_DATA`: 同一領域内ワード＋領域基底（`#PC-=0000`）
 * `.equ` やゼロページ / `_WORK` はアセンブル時確定なので null。
 * @param expr - オペランド文字列
 * @param symbolInfos - シンボル情報表
 * @return リロケーション左右オペランド。不要なら null
 */
export function matchAbsAddrReloc(
  expr: string,
  symbolInfos: SymbolInfoTable,
): { left: RelocOperand; right: RelocOperand } | null {
  const name = parseSimpleSymbolOperand(expr);
  if (!name) return null;
  const info = symbolInfos.get(name);
  if (!info) return null;
  if (info.kind === "external" || info.kind === "global") {
    return {
      left: { kind: "symbol", name },
      right: { kind: "const", value: 0 },
    };
  }
  const area = info.area ? info.area.trim().toUpperCase() : "";
  if (area !== "_CODE" && area !== "_DATA") return null;
  return {
    left: { kind: "word", value: info.value & 0xffff, area },
    right: { kind: "const", value: 0 },
  };
}

/**
 * `.word A - B` で、少なくとも一方が external のアドレス差を検出する。
 * 両方が定義済みなら null（アセンブル時に確定させる）。
 * @param expr - 式文字列
 * @param symbolInfos - シンボル情報表
 * @return 検出できれば { left, right }。なければ null
 */
export function matchWordDiffReloc(
  expr: string,
  symbolInfos: SymbolInfoTable,
): { left: RelocOperand; right: RelocOperand } | null {
  const m: RegExpMatchArray | null = expr
    .trim()
    .match(
      /^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*-\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*$/,
    );
  if (!m) return null;
  const leftName: string = m[1].toUpperCase();
  const rightName: string = m[2].toUpperCase();
  const left = toRelocOperand(leftName, symbolInfos);
  const right = toRelocOperand(rightName, symbolInfos);
  if (!left || !right) return null;
  // 両方ともアセンブル時に確定できるならリロケーション不要
  if (left.kind === "word" && right.kind === "word") return null;
  return { left, right };
}

/**
 * @deprecated matchWordDiffReloc を使用
 */
export function matchExternalWordDiff(
  expr: string,
  symbolInfos: SymbolInfoTable,
): { left: string; right: string } | null {
  const r = matchWordDiffReloc(expr, symbolInfos);
  if (!r) return null;
  if (r.left.kind !== "symbol" || r.right.kind !== "symbol") return null;
  return { left: r.left.name, right: r.right.name };
}

/**
 * 数値リテラルトークンを解析して数値を返す。
 * 対応形式:
 *   16進： `0x`/`0X` prefix, `H`/`h` suffix （例: `0xFF`, `1AH`, `0abH`）
 *   8進：  `0o`/`0O` prefix, `O`/`o`/`Q`/`q` suffix （例: `0o17`, `377Q`）
 *   2進：  `0b`/`0B` prefix, `B`/`b` suffix （例: `0b1010`, `1010B`）
 *   10進： `D`/`d` suffix または素の数字 （例: `42`, `255D`）
 * @param token - 数値トークン
 * @return 解析できた数値。解析不可の場合はundefined
 */
function parseNumber(token: string): number | undefined {
  const t: string = token.trim();
  // TI 風 16進: >xxxx
  if (/^>[0-9a-f]+$/i.test(t)) return Number.parseInt(t.slice(1), 16);
  // 16進数: 0x / 0X prefix
  if (/^0[xX][0-9a-f]+$/i.test(t)) return Number.parseInt(t, 16);
  // 8進数: 0o / 0O prefix
  if (/^0[oO][0-7]+$/.test(t)) return Number.parseInt(t.slice(2), 8);
  // 2進数: 0b / 0B prefix
  if (/^0[bB][01]+$/.test(t)) return Number.parseInt(t.slice(2), 2);
  // 16進数: H / h suffix（A-F 対応、先頭は必ず数字）
  if (/^[0-9a-f]+[Hh]$/i.test(t)) return Number.parseInt(t.slice(0, -1), 16);
  // 8進数: O / o / Q / q suffix
  if (/^[0-7]+[OoQq]$/.test(t)) return Number.parseInt(t.slice(0, -1), 8);
  // 2進数: B / b suffix
  if (/^[01]+[Bb]$/.test(t)) return Number.parseInt(t.slice(0, -1), 2);
  // 10進数: D / d suffix
  if (/^[0-9]+[Dd]$/.test(t)) return Number.parseInt(t.slice(0, -1), 10);
  // 10進数
  if (/^[0-9]+$/.test(t)) return Number.parseInt(t, 10);
  return undefined;
}

/**
 * 式文字列を評価して数値を返す。
 * 対応演算子と優先順位（低→高）:
 *   `|`（ビットOR） `^`（ビットXOR） `&`（ビットAND）
 *   `<<` `>>`（シフト） `+` `-`（加減算） `*` `/` `%`（乗除剰余）
 *   単項 `+` `-` `~`、括弧 `()`
 * @param expr - 式文字列
 * @param symbols - シンボルテーブル
 * @param allowUndefined - 未定義シンボル許可フラグ
 * @return 評価結果の数値
 */
export function evalExpr(
  expr: string,
  symbols: SymbolTable,
  allowUndefined: boolean,
): number {
  const matched: RegExpMatchArray | null = expr.match(
    /[A-Za-z_.$][A-Za-z0-9_.$]*|>[0-9A-Fa-f]+|0[xX][0-9A-Fa-f]+|0[oO][0-7]+|0[bB][01]+|[0-9A-Fa-f]+[Hh]|[0-7]+[OoQq]|[01]+[Bb]|[0-9]+[Dd]?|<<|>>|[()+\-*/%&|^~]/g,
  );
  if (!matched || matched.length === 0) {
    throw new Error(`Empty expression: ${expr}`);
  }
  const tokens = matched;
  let idx: number = 0;

  /**
   * primary規則（リテラル・シンボル・括弧式・単項演算）を解釈する。
   * @return 評価結果の数値
   */
  function parsePrimary(): number {
    if (idx >= tokens.length) throw new Error(`Invalid expression: ${expr}`);
    const t: string = tokens[idx++];
    if (t === "(") {
      const v: number = parseBitwiseOr();
      if (tokens[idx] !== ")")
        throw new Error(`Missing ')' in expression: ${expr}`);
      idx += 1;
      return v;
    }
    if (t === "+") return parsePrimary();
    if (t === "-") return -parsePrimary();
    if (t === "~") return ~parsePrimary() & 0xffff; // 16bit NOT

    const num: number | undefined = parseNumber(t);
    if (num !== undefined) return num;

    const key: string = t.toUpperCase();
    const val: number | undefined = symbols.get(key);
    if (val === undefined) {
      if (allowUndefined) return 0;
      throw new Error(`Undefined symbol: ${t}`);
    }
    return val;
  }

  /**
   * 乗除剰余算（* / %）を評価する。
   * @return 評価結果の数値
   */
  function parseMulDiv(): number {
    let v: number = parsePrimary();
    while (idx < tokens.length) {
      const op: string = tokens[idx];
      if (op !== "*" && op !== "/" && op !== "%") break;
      idx += 1;
      const r: number = parsePrimary();
      if (op === "*") {
        v = v * r;
      } else if (op === "/") {
        if (r === 0) throw new Error(`Division by zero in expression: ${expr}`);
        v = Math.trunc(v / r);
      } else {
        if (r === 0) throw new Error(`Modulo by zero in expression: ${expr}`);
        v = v % r;
      }
    }
    return v;
  }

  /**
   * 加減算（+ -）を評価する。
   * @return 評価結果の数値
   */
  function parseAddSub(): number {
    let v: number = parseMulDiv();
    while (idx < tokens.length) {
      const op: string = tokens[idx];
      if (op !== "+" && op !== "-") break;
      idx += 1;
      v = op === "+" ? v + parseMulDiv() : v - parseMulDiv();
    }
    return v;
  }

  /**
   * ビットシフト（<< >>）を評価する。
   * @return 評価結果の数値
   */
  function parseShift(): number {
    let v: number = parseAddSub();
    while (idx < tokens.length) {
      const op: string = tokens[idx];
      if (op !== "<<" && op !== ">>") break;
      idx += 1;
      const r: number = parseAddSub();
      v = op === "<<" ? (v << r) & 0xffff : (v >>> r) & 0xffff;
    }
    return v;
  }

  /**
   * ビットAND（&）を評価する。
   * @return 評価結果の数値
   */
  function parseBitwiseAnd(): number {
    let v: number = parseShift();
    while (idx < tokens.length && tokens[idx] === "&") {
      idx += 1;
      v = v & parseShift();
    }
    return v;
  }

  /**
   * ビットXOR（^）を評価する。
   * @return 評価結果の数値
   */
  function parseBitwiseXor(): number {
    let v: number = parseBitwiseAnd();
    while (idx < tokens.length && tokens[idx] === "^") {
      idx += 1;
      v = v ^ parseBitwiseAnd();
    }
    return v;
  }

  /**
   * ビットOR（|）を評価する。
   * @return 評価結果の数値
   */
  function parseBitwiseOr(): number {
    let v: number = parseBitwiseXor();
    while (idx < tokens.length && tokens[idx] === "|") {
      idx += 1;
      v = v | parseBitwiseXor();
    }
    return v;
  }

  const result: number = parseBitwiseOr();

  if (idx !== tokens.length) {
    throw new Error(`Unexpected token in expression: ${tokens[idx]}`);
  }
  return result;
}
