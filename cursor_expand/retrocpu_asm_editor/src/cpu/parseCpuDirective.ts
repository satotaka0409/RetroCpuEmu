/**
 * ソース先頭の `.cpu` 疑似命令を読む（asm-rules.mdc / retrocpu_asm cpuType.ts と同じ規約）。
 * エディタ用: 不正・後段・重複は throw せず undefined（既定 CPU にフォールバック）。
 * `.cpu mn1610` は無効（診断でエラー）。
 */

/** 指定できる CPU ID（大文字小文字無視） */
export const CPU_DIRECTIVE_IDS = ["mn1613", "tms9995"] as const;

/** `.cpu` で使える ID */
export type CpuDirectiveId = (typeof CPU_DIRECTIVE_IDS)[number];

/** `.cpu mn1610` などの不正指定 */
export type CpuDirectiveIssue = {
  /** 0-based 行 */
  line: number;
  /** 問題箇所の開始列 */
  start: number;
  /** 問題箇所の終了列 */
  end: number;
  /** 診断メッセージ */
  message: string;
};

/**
 * CPU 名を正規化する。
 * @param value 入力
 * @returns 既知なら ID。不明なら null（mn1610 含む）
 */
export function parseCpuDirectiveId(
  value: string | undefined,
): CpuDirectiveId | null {
  if (value === undefined) return null;
  const v = value.trim().toLowerCase();
  if (v === "mn1613" || v === "tms9995") return v;
  return null;
}

/**
 * 行末コメントを除いた本文を返す。
 * @param line 1 行
 * @returns トリム済み本文
 */
function lineBody(line: string): string {
  const semi = line.indexOf(";");
  const slash = line.indexOf("//");
  let cut = line.length;
  if (semi >= 0) cut = Math.min(cut, semi);
  if (slash >= 0) cut = Math.min(cut, slash);
  return line.slice(0, cut).trim();
}

/**
 * `.cpu` の未知オペランド（mn1610 含む）を探す。
 * @param sourceText アセンブラソース全文
 * @returns 診断用ヒット
 */
export function findInvalidCpuDirectives(
  sourceText: string,
): CpuDirectiveIssue[] {
  const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
  const issues: CpuDirectiveIssue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const body = lineBody(raw);
    const m = body.match(/^\.cpu(?:\s+(\S+))?$/i);
    if (!m) continue;
    const cpu = parseCpuDirectiveId(m[1]);
    if (cpu) continue;
    const token = m[1]?.trim();
    let start: number;
    let end: number;
    let label: string;
    if (token) {
      start = raw.toLowerCase().indexOf(token.toLowerCase());
      end = start >= 0 ? start + token.length : raw.length;
      label = token;
    } else {
      const cpuTok = raw.match(/\.cpu/i);
      start = cpuTok?.index ?? 0;
      end = start + 4;
      label = "";
    }
    issues.push({
      line: i,
      start: Math.max(0, start),
      end,
      message: label ? `未知の CPU: ${label}` : "未知の CPU",
    });
  }
  return issues;
}

/**
 * ソース先頭（コメント・空行を除く）の `.cpu` を読む。
 * 先頭以外・不正値（mn1610 含む）・重複・オペランド無しは無視して undefined。
 * @param sourceText アセンブラソース全文
 * @returns 有効な `.cpu` があればその ID
 */
export function scanSourceCpuId(
  sourceText: string,
): CpuDirectiveId | undefined {
  const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
  let seenContent = false;
  let found: CpuDirectiveId | undefined;

  for (const line of lines) {
    const body = lineBody(line);
    if (!body) continue;

    const m = body.match(/^\.cpu(?:\s+(\S+))?$/i);
    if (m) {
      if (seenContent) return undefined;
      if (found !== undefined) return undefined;
      const cpu = parseCpuDirectiveId(m[1]);
      if (!cpu) return undefined;
      found = cpu;
      seenContent = true;
      continue;
    }

    seenContent = true;
  }

  return found;
}
