/**
 * ASxxxx / sdas 準拠のマクロ／リピート展開
 *
 * 対応:
 *   .macro name [, args...] ... .endm
 *   .mexit
 *   .rept exp ... .endm
 *   .irp  sym, arg, ... ... .endm
 *   .irpc sym, string ... .endm
 *   ネストした .macro 定義（外側展開後に定義される）
 *   マクロ呼び出しのネスト
 *
 * `?` は展開ごとに一意な接尾辞へ置換（ローカルラベル用）。
 */

export interface MacroDef {
  name: string;
  args: string[];
  body: string[];
  definedAt: number;
}

const MAX_EXPAND_DEPTH = 64;
const MAX_PASSES = 32;

/**
 * 行末コメントを除去する。
 * @param line - 入力1行
 * @return コメント除去後
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
 * カンマ区切り引数を分割する（括弧・文字列内のカンマは分割しない）。
 * @param text - 引数リスト文字列
 * @return 引数配列
 */
function splitCommaArgs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const args: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(" || ch === "[") {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() || args.length > 0) args.push(cur.trim());
  return args.filter((a) => a.length > 0);
}

/**
 * 命令行を label / op / args に分解する。
 * @param raw - 生の1行
 * @return 分解結果
 */
function splitAsmLine(raw: string): {
  label: string | null;
  op: string | null;
  argsText: string;
  indent: string;
} {
  const body = stripLineComment(raw);
  const indentMatch = body.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? "";
  let rest = body.trim();
  if (!rest) {
    return { label: null, op: null, argsText: "", indent };
  }

  let label: string | null = null;
  const labelColon = rest.match(/^([A-Za-z_.?][A-Za-z0-9_.?]*)\s*:\s*(.*)$/);
  if (labelColon) {
    label = labelColon[1]!;
    rest = labelColon[2]!.trim();
  }

  if (!rest) {
    return { label, op: null, argsText: "", indent };
  }

  const m = rest.match(/^([A-Za-z_.][A-Za-z0-9_.]*)\s*(.*)$/);
  if (!m) {
    return { label, op: null, argsText: rest, indent };
  }
  return {
    label,
    op: m[1]!,
    argsText: m[2]!.trim(),
    indent,
  };
}

/**
 * 正規表現用にエスケープする。
 * @param s - 文字列
 * @return エスケープ済み
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 仮引数名を本体テキスト内で実引数に置換する。
 * @param text - 置換対象
 * @param dummy - 仮引数名
 * @param actual - 実引数
 * @return 置換後テキスト
 */
function replaceArg(text: string, dummy: string, actual: string): string {
  if (!dummy) return text;
  const re = new RegExp(`\\b${escapeRegExp(dummy)}\\b`, "gi");
  return text.replace(re, actual);
}

/**
 * 展開IDで `?` を一意化する。
 * @param text - 対象テキスト
 * @param expandId - 展開通し番号
 * @return 置換後
 */
function replaceLocalMarks(text: string, expandId: number): string {
  return text.replace(/\?/g, `M${expandId}`);
}

/**
 * バインディングを適用して1行を置換する。
 * @param line - 行
 * @param binding - 仮引数→実引数
 * @param expandId - ローカルID
 * @return 置換後行
 */
function applyBindings(
  line: string,
  binding: Map<string, string>,
  expandId: number,
): string {
  let out = line;
  const keys = [...binding.keys()].sort((a, b) => b.length - a.length);
  for (const k of keys) {
    out = replaceArg(out, k, binding.get(k)!);
  }
  return replaceLocalMarks(out, expandId);
}

/**
 * .macro 名と仮引数リストを解析する。
 * @param argsText - `.macro` のオペランド
 * @return 名前と仮引数
 */
function parseMacroHeader(argsText: string): {
  name: string;
  formalArgs: string[];
} {
  const parts = splitCommaArgs(argsText);
  let name = "";
  let formalArgs: string[] = [];
  if (parts.length >= 1) {
    const first = parts[0]!;
    const sp = first.trim().split(/\s+/);
    if (sp.length > 1) {
      name = sp[0]!;
      formalArgs = [sp.slice(1).join(" "), ...parts.slice(1)]
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      name = first;
      formalArgs = parts.slice(1);
    }
  }
  return { name, formalArgs };
}

/** ブロック開始ディレクティブか */
function isBlockOpen(op: string | null): boolean {
  if (!op) return false;
  return /^\.(macro|rept|irp|irpc)$/i.test(op);
}

/** .endm か */
function isEndm(op: string | null): boolean {
  return !!op && /^\.endm$/i.test(op);
}

/**
 * 絶対式（リピート回数）を評価する。定数のみ。
 * @param expr - 式文字列
 * @param lineNo - 行番号（エラー用）
 * @return 非負整数
 */
function evalRepeatCount(expr: string, lineNo: number): number {
  const t = expr.trim().replace(/\$/g, "0x");
  if (!t) {
    throw new Error(`.rept requires a count (line ${lineNo})`);
  }
  // 単純な整数 / 0xHEX / 四則（定数のみ）
  if (!/^[\d\sxXa-fA-F+\-*/()]+$/.test(t)) {
    throw new Error(`Invalid .rept count '${expr}' (line ${lineNo})`);
  }
  let value: number;
  try {
    // eslint-disable-next-line no-new-func
    value = Function(`"use strict"; return (${t});`)() as number;
  } catch {
    throw new Error(`Cannot evaluate .rept count '${expr}' (line ${lineNo})`);
  }
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`.rept count must be a non-negative integer (line ${lineNo})`);
  }
  return value;
}

/**
 * ネストを考慮してブロック本体を読み取る（開始行の次から .endm まで）。
 * @param lines - 全行
 * @param start - 本体開始インデックス
 * @param openLineNo - 開始ディレクティブ行番号
 * @return 本体と次インデックス
 */
function readBlockBody(
  lines: string[],
  start: number,
  openLineNo: number,
): { body: string[]; next: number } {
  const body: string[] = [];
  let depth = 1;
  let i = start;
  while (i < lines.length) {
    const { op } = splitAsmLine(lines[i]!);
    if (isBlockOpen(op)) {
      depth += 1;
      body.push(lines[i]!);
      i += 1;
      continue;
    }
    if (isEndm(op)) {
      depth -= 1;
      if (depth === 0) {
        return { body, next: i + 1 };
      }
      body.push(lines[i]!);
      i += 1;
      continue;
    }
    body.push(lines[i]!);
    i += 1;
  }
  throw new Error(`Unclosed block (started at line ${openLineNo})`);
}

/**
 * ソースからトップレベル .macro 定義を抽出し、定義行を除いたソースを返す。
 * 本体中のネスト .macro は深さ付きで本体に残す。
 * @param sourceText - 入力ソース
 * @return マクロ表と定義除去後ソース
 */
export function extractMacros(sourceText: string): {
  macros: Map<string, MacroDef>;
  sourceWithoutDefs: string;
} {
  const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
  const macros = new Map<string, MacroDef>();
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    const { op, argsText } = splitAsmLine(raw);
    if (op && /^\.macro$/i.test(op)) {
      const { name, formalArgs } = parseMacroHeader(argsText);
      if (!name) {
        throw new Error(`.macro requires a name (line ${i + 1})`);
      }
      const key = name.toUpperCase();
      if (macros.has(key)) {
        throw new Error(`Duplicate macro '${name}' (line ${i + 1})`);
      }
      const startLine = i + 1;
      const { body, next } = readBlockBody(lines, i + 1, startLine);
      macros.set(key, {
        name,
        args: formalArgs,
        body,
        definedAt: startLine,
      });
      i = next;
      continue;
    }
    // .rept / .irp / .irpc はここでは展開せず、閉じ .endm ごと残す
    if (op && /^\.(rept|irp|irpc)$/i.test(op)) {
      const startLine = i + 1;
      const { body, next } = readBlockBody(lines, i + 1, startLine);
      out.push(raw);
      for (const b of body) out.push(b);
      out.push(lines[next - 1]!); // .endm
      i = next;
      continue;
    }
    if (isEndm(op)) {
      throw new Error(`.endm without matching block (line ${i + 1})`);
    }
    out.push(raw);
    i += 1;
  }
  return { macros, sourceWithoutDefs: out.join("\n") };
}

/**
 * マクロ／リピート本体を展開する（.mexit 対応）。
 * @param body - 本体行
 * @param binding - 置換表
 * @param expandId - ローカルID
 * @param macros - マクロ表（ネスト呼び出し用）
 * @param expandLines - 再帰展開関数
 * @param depth - 深さ
 * @return 展開行
 */
function expandBodyLines(
  body: string[],
  binding: Map<string, string>,
  expandId: number,
  macros: Map<string, MacroDef>,
  expandLines: (lines: string[], depth: number) => string[],
  depth: number,
): string[] {
  const substituted: string[] = [];
  for (const raw of body) {
    const { op } = splitAsmLine(raw);
    if (op && /^\.mexit$/i.test(op)) {
      break;
    }
    substituted.push(applyBindings(raw, binding, expandId));
  }
  return expandLines(substituted, depth + 1);
}

/**
 * マクロ呼び出し・.rept/.irp/.irpc を再帰的に展開する。
 * @param sourceText - 定義除去済みソース
 * @param macros - マクロ表
 * @return 展開済みソース
 */
function expandCallsAndRepeats(
  sourceText: string,
  macros: Map<string, MacroDef>,
): string {
  let expandId = 0;

  const expandLines = (lines: string[], depth: number): string[] => {
    if (depth > MAX_EXPAND_DEPTH) {
      throw new Error(`Macro expansion exceeded max depth (${MAX_EXPAND_DEPTH})`);
    }
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i]!;
      const { label, op, argsText, indent } = splitAsmLine(raw);

      if (!op) {
        out.push(raw);
        i += 1;
        continue;
      }

      // .rept count
      if (/^\.rept$/i.test(op)) {
        const count = evalRepeatCount(argsText, i + 1);
        const { body, next } = readBlockBody(lines, i + 1, i + 1);
        for (let r = 0; r < count; r += 1) {
          expandId += 1;
          out.push(
            ...expandBodyLines(
              body,
              new Map(),
              expandId,
              macros,
              expandLines,
              depth,
            ),
          );
        }
        i = next;
        continue;
      }

      // .irp sym, a, b, c
      if (/^\.irp$/i.test(op)) {
        const parts = splitCommaArgs(argsText);
        if (parts.length < 1) {
          throw new Error(`.irp requires a symbol (line ${i + 1})`);
        }
        const sym = parts[0]!;
        const list = parts.slice(1);
        const { body, next } = readBlockBody(lines, i + 1, i + 1);
        for (const actual of list) {
          expandId += 1;
          const binding = new Map<string, string>([[sym.toUpperCase(), actual]]);
          out.push(
            ...expandBodyLines(body, binding, expandId, macros, expandLines, depth),
          );
        }
        i = next;
        continue;
      }

      // .irpc sym, STRING  or .irpc sym STRING
      if (/^\.irpc$/i.test(op)) {
        const parts = splitCommaArgs(argsText);
        let sym = "";
        let chars = "";
        if (parts.length >= 2) {
          sym = parts[0]!;
          chars = parts.slice(1).join(",");
        } else {
          const sp = argsText.trim().split(/\s+/);
          sym = sp[0] ?? "";
          chars = sp.slice(1).join("") || "";
        }
        chars = chars.replace(/^["']|["']$/g, "");
        if (!sym) {
          throw new Error(`.irpc requires a symbol (line ${i + 1})`);
        }
        const { body, next } = readBlockBody(lines, i + 1, i + 1);
        for (const ch of chars) {
          expandId += 1;
          const binding = new Map<string, string>([[sym.toUpperCase(), ch]]);
          out.push(
            ...expandBodyLines(body, binding, expandId, macros, expandLines, depth),
          );
        }
        i = next;
        continue;
      }

      if (/^\.macro$/i.test(op) || isEndm(op) || /^\.mexit$/i.test(op)) {
        // 定義抽出後に残っている場合や、展開途中の未処理
        if (/^\.mexit$/i.test(op)) {
          throw new Error(`.mexit outside macro/repeat (line ${i + 1})`);
        }
        out.push(raw);
        i += 1;
        continue;
      }

      const def = macros.get(op.toUpperCase());
      if (!def) {
        out.push(raw);
        i += 1;
        continue;
      }

      expandId += 1;
      const actual = splitCommaArgs(argsText);
      if (actual.length > def.args.length) {
        throw new Error(
          `Macro '${def.name}' expects at most ${def.args.length} argument(s), got ${actual.length}`,
        );
      }
      const binding = new Map<string, string>();
      for (let ai = 0; ai < def.args.length; ai += 1) {
        binding.set(def.args[ai]!.toUpperCase(), actual[ai] ?? "");
      }

      const bodyOut = expandBodyLines(
        def.body,
        binding,
        expandId,
        macros,
        expandLines,
        depth,
      );

      if (label) {
        if (bodyOut.length === 0) {
          out.push(`${indent}${label}:`);
        } else {
          const first = splitAsmLine(bodyOut[0]!);
          if (first.label) {
            out.push(`${indent}${label}:`);
            out.push(...bodyOut);
          } else if (first.op) {
            bodyOut[0] =
              `${indent}${label}:\t${first.op}${first.argsText ? "\t" + first.argsText : ""}`;
            out.push(...bodyOut);
          } else {
            out.push(`${indent}${label}:`);
            out.push(...bodyOut);
          }
        }
      } else {
        out.push(...bodyOut);
      }
      i += 1;
    }
    return out;
  };

  const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
  return expandLines(lines, 0).join("\n");
}

/**
 * ソース全文のマクロ／リピートを展開する。
 * ネスト定義は複数パスで処理する。
 * @param sourceText - 入力ASMソース
 * @return 展開済みソース
 */
export function expandMacros(sourceText: string): string {
  let text = sourceText.replace(/\r\n/g, "\n");
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const { macros, sourceWithoutDefs } = extractMacros(text);
    const expanded = expandCallsAndRepeats(sourceWithoutDefs, macros);
    if (expanded === text) {
      // 未展開の .macro が残っていたらエラー
      if (/\.macro\b/i.test(expanded)) {
        throw new Error("Unexpanded .macro left in source after expansion");
      }
      return expanded;
    }
    text = expanded;
  }
  throw new Error(`Macro expansion exceeded max passes (${MAX_PASSES})`);
}
