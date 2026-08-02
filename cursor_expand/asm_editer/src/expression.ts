/**
 * エディタ用の簡易式評価（定数ホバー向け）。
 * retrocpu_asm の evalExpr と同等のリテラル・演算子を扱う。
 */

function parseNumber(token: string): number | undefined {
  const t = token.trim();
  if (/^0[xX][0-9a-f]+$/i.test(t)) return Number.parseInt(t, 16);
  if (/^0[oO][0-7]+$/.test(t)) return Number.parseInt(t.slice(2), 8);
  if (/^0[bB][01]+$/.test(t)) return Number.parseInt(t.slice(2), 2);
  if (/^[0-9][0-9a-f]*[Hh]$/i.test(t))
    return Number.parseInt(t.slice(0, -1), 16);
  if (/^[0-7]+[OoQq]$/.test(t)) return Number.parseInt(t.slice(0, -1), 8);
  if (/^[01]+[Bb]$/.test(t)) return Number.parseInt(t.slice(0, -1), 2);
  if (/^[0-9]+[Dd]$/.test(t)) return Number.parseInt(t.slice(0, -1), 10);
  if (/^[0-9]+$/.test(t)) return Number.parseInt(t, 10);
  return undefined;
}

/**
 * 式を評価する。
 * @param expr - 式文字列
 * @param symbols - シンボル名→値
 * @return 評価値。未定義シンボル等で失敗したら undefined
 */
export function tryEvalExpr(
  expr: string,
  symbols: Map<string, number>,
): number | undefined {
  try {
    const matched = expr.match(
      /[A-Za-z_.$][A-Za-z0-9_.$]*|0[xX][0-9A-Fa-f]+|0[oO][0-7]+|0[bB][01]+|[0-9][0-9A-Fa-f]*[Hh]|[0-7]+[OoQq]|[01]+[Bb]|[0-9]+[Dd]?|<<|>>|[()+\-*/%&|^~]/g,
    );
    if (!matched || matched.length === 0) return undefined;
    const tokens = matched;
    let idx = 0;

    function parsePrimary(): number {
      if (idx >= tokens.length) throw new Error("bad");
      const t = tokens[idx++]!;
      if (t === "(") {
        const v = parseBitwiseOr();
        if (tokens[idx++] !== ")") throw new Error("bad");
        return v;
      }
      if (t === "+") return parsePrimary();
      if (t === "-") return -parsePrimary();
      if (t === "~") return ~parsePrimary() & 0xffff;

      const num = parseNumber(t);
      if (num !== undefined) return num;

      const val = symbols.get(t.toUpperCase());
      if (val === undefined) throw new Error("undef");
      return val;
    }

    function parseMulDiv(): number {
      let v = parsePrimary();
      while (idx < tokens.length) {
        const op = tokens[idx];
        if (op !== "*" && op !== "/" && op !== "%") break;
        idx += 1;
        const r = parsePrimary();
        if (op === "*") v = v * r;
        else if (op === "/") {
          if (r === 0) throw new Error("div0");
          v = Math.trunc(v / r);
        } else {
          if (r === 0) throw new Error("mod0");
          v = v % r;
        }
      }
      return v;
    }

    function parseAddSub(): number {
      let v = parseMulDiv();
      while (idx < tokens.length) {
        const op = tokens[idx];
        if (op !== "+" && op !== "-") break;
        idx += 1;
        v = op === "+" ? v + parseMulDiv() : v - parseMulDiv();
      }
      return v;
    }

    function parseShift(): number {
      let v = parseAddSub();
      while (idx < tokens.length) {
        const op = tokens[idx];
        if (op !== "<<" && op !== ">>") break;
        idx += 1;
        const r = parseAddSub();
        v = op === "<<" ? (v << r) & 0xffff : (v >>> r) & 0xffff;
      }
      return v;
    }

    function parseAnd(): number {
      let v = parseShift();
      while (idx < tokens.length && tokens[idx] === "&") {
        idx += 1;
        v = v & parseShift();
      }
      return v;
    }

    function parseXor(): number {
      let v = parseAnd();
      while (idx < tokens.length && tokens[idx] === "^") {
        idx += 1;
        v = v ^ parseAnd();
      }
      return v;
    }

    function parseBitwiseOr(): number {
      let v = parseXor();
      while (idx < tokens.length && tokens[idx] === "|") {
        idx += 1;
        v = v | parseXor();
      }
      return v;
    }

    const value = parseBitwiseOr();
    if (idx !== tokens.length) return undefined;
    return value | 0;
  } catch {
    return undefined;
  }
}
