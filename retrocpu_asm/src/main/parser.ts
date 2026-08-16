import type { ParsedLine, SourceLine } from "./types";

interface ParseOk<T> {
  ok: true;
  value: T;
  next: number;
}

interface ParseNg {
  ok: false;
  expected: string;
  at: number;
}

type ParseResult<T> = ParseOk<T> | ParseNg;
type Parser<T> = (input: string, index: number) => ParseResult<T>;

/**
 * 成功パース結果を生成する。
 * @param value - 解析結果
 * @param next - 次に読む位置
 * @return 成功時のパース結果
 */
function ok<T>(value: T, next: number): ParseOk<T> {
  return { ok: true, value, next };
}

/**
 * 失敗パース結果を生成する。
 * @param expected - 期待した要素名
 * @param at - エラー位置
 * @return 失敗時のパース結果
 */
function ng(expected: string, at: number): ParseNg {
  return { ok: false, expected, at };
}

/**
 * パーサの出力値を変換するパーサを生成する。
 * @param parser - 元パーサ
 * @param fn - 変換関数
 * @return 値変換付きパーサ
 */
function mapP<T, U>(parser: Parser<T>, fn: (value: T) => U): Parser<U> {
  return (input: string, index: number): ParseResult<U> => {
    const r: ParseResult<T> = parser(input, index);
    if (!r.ok) return r;
    return ok(fn(r.value), r.next);
  };
}

/**
 * 2つのパーサを順に適用するパーサを生成する。
 * @param left - 先行パーサ
 * @param right - 後続パーサ
 * @return 2つを順に適用するパーサ
 */
function seqP<A, B>(left: Parser<A>, right: Parser<B>): Parser<[A, B]> {
  return (input: string, index: number): ParseResult<[A, B]> => {
    const r1: ParseResult<A> = left(input, index);
    if (!r1.ok) return r1;
    const r2: ParseResult<B> = right(input, r1.next);
    if (!r2.ok) return r2;
    return ok([r1.value, r2.value], r2.next);
  };
}

/**
 * どちらか一方が成功するパーサを生成する。
 * @param first - 第1候補パーサ
 * @param second - 第2候補パーサ
 * @return どちらか成功した結果を返すパーサ
 */
function orP<T>(first: Parser<T>, second: Parser<T>): Parser<T> {
  return (input: string, index: number): ParseResult<T> => {
    const r1: ParseResult<T> = first(input, index);
    if (r1.ok) return r1;
    const r2: ParseResult<T> = second(input, index);
    if (r2.ok) return r2;
    return r2.at >= r1.at ? r2 : r1;
  };
}

/**
 * 任意（0または1回）マッチするパーサを生成する。
 * @param parser - 任意要素パーサ
 * @return 要素が無くても成功するパーサ
 */
function optionalP<T>(parser: Parser<T>): Parser<T | undefined> {
  return (input: string, index: number): ParseResult<T | undefined> => {
    const r: ParseResult<T> = parser(input, index);
    if (!r.ok) return ok(undefined, index);
    return ok(r.value, r.next);
  };
}

/**
 * 0回以上繰り返すパーサを生成する。
 * @param parser - 繰り返し対象パーサ
 * @return 0回以上の結果配列を返すパーサ
 */
function manyP<T>(parser: Parser<T>): Parser<T[]> {
  return (input: string, index: number): ParseResult<T[]> => {
    const out: T[] = [];
    let cur: number = index;
    while (true) {
      const r: ParseResult<T> = parser(input, cur);
      if (!r.ok) break;
      if (r.next === cur) break;
      out.push(r.value);
      cur = r.next;
    }
    return ok(out, cur);
  };
}

/**
 * 1文字に一致するパーサを生成する。
 * @param ch - 期待する1文字
 * @return 一致文字を返すパーサ
 */
function charP(ch: string): Parser<string> {
  return (input: string, index: number): ParseResult<string> => {
    if (input[index] === ch) return ok(ch, index + 1);
    return ng(`'${ch}'`, index);
  };
}

/**
 * 正規表現に一致するパーサを生成する。
 * @param re - 先頭一致用正規表現
 * @param expected - 期待要素名
 * @return 一致文字列を返すパーサ
 */
function regexP(re: RegExp, expected: string): Parser<string> {
  return (input: string, index: number): ParseResult<string> => {
    const rest: string = input.slice(index);
    const m: RegExpMatchArray | null = rest.match(re);
    if (!m || m.index !== 0) return ng(expected, index);
    return ok(m[0], index + m[0].length);
  };
}

/**
 * 区切り文字で区切られた1件以上の要素を解析するパーサを生成する。
 * @param item - 要素パーサ
 * @param sep - 区切りパーサ
 * @return 区切り付き1件以上の要素配列パーサ
 */
function sepBy1P<T, S>(item: Parser<T>, sep: Parser<S>): Parser<T[]> {
  return (input: string, index: number): ParseResult<T[]> => {
    const first: ParseResult<T> = item(input, index);
    if (!first.ok) return first;

    const restParser: Parser<[S, T]> = seqP(sep, item);
    const rest: ParseResult<[S, T][]> = manyP(restParser)(input, first.next);
    if (!rest.ok) return rest;

    const out: T[] = [first.value];
    for (const [, value] of rest.value) out.push(value);
    return ok(out, rest.next);
  };
}

/**
 * 行末のセミコロン／スラッシュコメントを除去する。
 * `'A'` / `"HELLO"` の中の `;` や `//` はコメントにしない。
 * @param line - 入力1行
 * @return コメント除去後の文字列
 */
export function stripLineComment(line: string): string {
  let i = 0;
  let quote: "'" | '"' | null = null;
  while (i < line.length) {
    const ch = line[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === ";") return line.slice(0, i);
    if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
    i += 1;
  }
  return line;
}

const ws0: Parser<string> = regexP(/^[ \t]*/, "whitespace");
const ws1: Parser<string> = regexP(/^[ \t]+/, "whitespace");
const ident: Parser<string> = regexP(/^[A-Za-z_.$][A-Za-z0-9_.$]*/, "label");
const opToken: Parser<string> = regexP(/^[^\s]+/, "opcode");

/**
 * ラベル宣言（識別子＋コロン）を解析する。
 * @param input - 解析対象文字列
 * @param index - 開始位置
 * @return ラベル宣言名
 */
function parseLabelDecl(input: string, index: number): ParseResult<string> {
  const parser: Parser<[string, string]> = seqP(ident, charP(":"));
  return mapP(parser, ([name]) => name)(input, index);
}

/**
 * コンマ区切りを考慮して1オペランドを解析する。
 * `'A'` / `"HELLO WORLD"` の中のコンマは区切りにしない。
 * @param input - 解析対象文字列
 * @param index - 開始位置
 * @return 1つ分のオペランド文字列
 */
function parseOperand(input: string, index: number): ParseResult<string> {
  let i: number = index;
  let bracket: number = 0;
  let paren: number = 0;

  while (i < input.length) {
    const ch: string = input[i];
    if ((ch === "'" || ch === '"') && bracket === 0 && paren === 0) {
      const q = ch;
      i += 1;
      while (i < input.length && input[i] !== q) i += 1;
      if (i < input.length) i += 1;
      continue;
    }
    if (ch === "[") bracket += 1;
    else if (ch === "]") bracket -= 1;
    else if (ch === "(") paren += 1;
    else if (ch === ")") paren -= 1;
    else if (ch === "," && bracket === 0 && paren === 0) break;
    i += 1;
  }

  const token: string = input.slice(index, i).trim();
  if (!token) return ng("operand", index);
  return ok(token, i);
}

/**
 * コンマ区切りのオペランドリストを解析する。
 * @param input - 解析対象文字列
 * @param index - 開始位置
 * @return オペランド配列
 */
function parseArgsList(input: string, index: number): ParseResult<string[]> {
  const comma: Parser<string> = mapP(
    seqP(seqP(ws0, charP(",")), ws0),
    () => ",",
  );
  return sepBy1P(parseOperand, comma)(input, index);
}

interface ParsedBody {
  label?: string;
  op?: string;
  args: string[];
}

/**
 * SDAS 流 `NAME .equ value`（コロンなし）を試す。
 * `.ds` / `.blkw` はラベルなので `NAME:` が必須（この形式では受けない）。
 * マッチしなければ null。
 */
function tryParseSdasStyleEqu(
  body: string,
  start: number,
): ParseResult<ParsedBody> | null {
  const rest = body.slice(start);
  const m = rest.match(
    /^([A-Za-z_.$][A-Za-z0-9_.$]*)[ \t]+(\.equ|equ)\b[ \t]+(.+)$/i,
  );
  if (!m) return null;
  const op = m[2]!.toUpperCase().startsWith(".") ? ".EQU" : "EQU";
  return ok(
    {
      label: m[1],
      op,
      args: [m[3]!.trim()],
    },
    body.length,
  );
}

/**
 * コメント除去後の1行からラベル・命令・引数を解析する。
 * @param body - コメント除去後の1行テキスト
 * @return ラベル/命令/引数をまとめた解析結果
 */
function parseBody(body: string): ParseResult<ParsedBody> {
  let cur: number = 0;

  const labelParser: Parser<string | undefined> = optionalP(parseLabelDecl);
  const labelRes: ParseResult<string | undefined> = labelParser(body, cur);
  if (!labelRes.ok) return labelRes;
  cur = labelRes.next;

  const spaceAfterLabel: ParseResult<string> = ws0(body, cur);
  if (!spaceAfterLabel.ok) return spaceAfterLabel;
  cur = spaceAfterLabel.next;

  if (cur >= body.length) {
    return ok({ label: labelRes.value, args: [] }, cur);
  }

  // SDAS流: NAME .equ value（コロンなし）。.ds / .blkw は NAME: が必須
  if (!labelRes.value) {
    const sdasEqu = tryParseSdasStyleEqu(body, cur);
    if (sdasEqu) return sdasEqu;
    const dsNoColon = body.slice(cur).match(
      /^([A-Za-z_.$][A-Za-z0-9_.$]*)[ \t]+(\.ds|\.blkw)\b/i,
    );
    if (dsNoColon) {
      return ng(
        `${dsNoColon[2]} label must end with ':' (write ${dsNoColon[1]}: ${dsNoColon[2]} ...)`,
        cur,
      );
    }
  }

  const opRes: ParseResult<string> = opToken(body, cur);
  if (!opRes.ok) return opRes;
  cur = opRes.next;

  const opTailParser: Parser<[string, string[]]> = mapP(
    seqP(ws1, parseArgsList),
    ([, args]) => ["", args],
  );
  const noArgsParser: Parser<[string, string[]]> = mapP(ws0, () => ["", []]);
  const tailRes: ParseResult<[string, string[]]> = orP(
    opTailParser,
    noArgsParser,
  )(body, cur);
  if (!tailRes.ok) return tailRes;
  cur = tailRes.next;

  const trailing: ParseResult<string> = ws0(body, cur);
  if (!trailing.ok) return trailing;
  cur = trailing.next;

  if (cur !== body.length) {
    return ng("end of line", cur);
  }

  const args: string[] = tailRes.value[1];
  return ok(
    {
      label: labelRes.value,
      op: opRes.value.toUpperCase(),
      args,
    },
    cur,
  );
}

/**
 * アセンブラソース全文を行ごとに解析する。
 * @param text - アセンブラソース全文
 * @return 元行配列と解析済み行配列
 */
export function parseSource(text: string): {
  sourceLines: SourceLine[];
  parsed: ParsedLine[];
} {
  const sourceLines: SourceLine[] = [];
  const parsed: ParsedLine[] = [];

  const lines: string[] = text.replace(/\r\n/g, "\n").split("\n");
  for (let i: number = 0; i < lines.length; i += 1) {
    const raw: string = lines[i];
    const lineNo: number = i + 1;
    sourceLines.push({ lineNo, text: raw });

    const stripped: string = stripLineComment(raw);
    const body: string = stripped.trim();
    if (!body) {
      parsed.push({ lineNo, text: raw, args: [] });
      continue;
    }

    // sdas/asxxxx: 第1欄（左端）はラベル専用。疑似命令は字下げする。
    // sdas 自体は '.' を LETTER 扱いするので左端の .area でも通るが、
    // ラベルと疑似命令が区別できなくなるためここではエラーにする。
    if (stripped.startsWith(".")) {
      throw new Error(
        `Line ${lineNo}: pseudo-op must not start in column 1 (indent .cpu/.area/.org/.include/.equ; labels go in column 1)`,
      );
    }

    const bodyRes: ParseResult<ParsedBody> = parseBody(body);
    if (!bodyRes.ok) {
      throw new Error(
        `Parse error at line ${lineNo} (col ${bodyRes.at + 1}): expected ${bodyRes.expected}`,
      );
    }

    parsed.push({
      lineNo,
      text: raw,
      label: bodyRes.value.label,
      op: bodyRes.value.op,
      args: bodyRes.value.args,
    });
  }

  return { sourceLines, parsed };
}
