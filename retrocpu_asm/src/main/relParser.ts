import type { RelocOperand, WordDiffReloc } from "./types";
import { AREA_FLAG_NOLOAD, canonicalAreaName } from "./areaOrder";

/** 1 領域分の REL 内容 */
export interface RelArea {
  name: string;
  /** サイズ（バイト） */
  size: number;
  noload: boolean;
  /** 領域内オフセット → データバイト */
  code: Map<number, number>;
}

/** グローバル定義（領域内バイトオフセット） */
export interface RelSymbolDef {
  offset: number;
  area: string;
}

/** パースした REL モジュール */
export interface RelModule {
  moduleName: string;
  areas: RelArea[];
  /** グローバル定義 */
  defs: Map<string, RelSymbolDef>;
  /** 外部参照名 */
  refs: Set<string>;
  /** ワード差リロケーション */
  relocs: Array<WordDiffReloc & { area: string }>;
}

/**
 * W レコードのオペランド文字列をパースする。
 * @param token - シンボル名、#XXXX / #_DATA:XXXX（領域内ワード）、=XXXX（絶対定数）
 * @return RelocOperand
 */
function parseRelocOperand(token: string): RelocOperand {
  if (token.startsWith("=")) {
    return { kind: "const", value: Number.parseInt(token.slice(1), 16) & 0xffff };
  }
  if (token.startsWith("#")) {
    const rest = token.slice(1);
    const colon = rest.indexOf(":");
    if (colon >= 0) {
      return {
        kind: "word",
        area: canonicalAreaName(rest.slice(0, colon)),
        value: Number.parseInt(rest.slice(colon + 1), 16) & 0xffff,
      };
    }
    return { kind: "word", value: Number.parseInt(rest, 16) & 0xffff };
  }
  return { kind: "symbol", name: token.toUpperCase() };
}

/**
 * 領域を取得または作成する。
 * @param areas - 領域配列
 * @param byName - 名前索引
 * @param name - 領域名
 * @returns 領域
 */
function ensureArea(
  areas: RelArea[],
  byName: Map<string, RelArea>,
  name: string,
): RelArea {
  const key = canonicalAreaName(name);
  let area = byName.get(key);
  if (!area) {
    area = {
      name: key,
      size: 0,
      noload: key === "_WORK",
      code: new Map(),
    };
    byName.set(key, area);
    areas.push(area);
  }
  return area;
}

/**
 * REL 形式テキストをパースする。
 * @param text - .rel ファイル内容
 * @return パース結果モジュール
 */
export function parseRel(text: string): RelModule {
  const lines: string[] = text.replace(/\r\n/g, "\n").split("\n");
  let moduleName = "MN1610";
  const areas: RelArea[] = [];
  const byName: Map<string, RelArea> = new Map();
  const defs: Map<string, RelSymbolDef> = new Map();
  const refs: Set<string> = new Set();
  const relocs: Array<WordDiffReloc & { area: string }> = [];
  let current = ensureArea(areas, byName, "_CODE");

  for (const raw of lines) {
    const line: string = raw.trim();
    if (!line) continue;

    if (line.startsWith("M ")) {
      moduleName = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("A ")) {
      const m = line.match(
        /A\s+(\S+)\s+size\s+([0-9A-Fa-f]+)(?:\s+flags\s+([0-9A-Fa-f]+))?/i,
      );
      if (!m) continue;
      const name = canonicalAreaName(m[1]!);
      const size = Number.parseInt(m[2]!, 16);
      const flags = m[3] ? Number.parseInt(m[3], 16) : 0;
      current = ensureArea(areas, byName, name);
      current.size = Math.max(current.size, size);
      if ((flags & AREA_FLAG_NOLOAD) !== 0 || name === "_WORK") {
        current.noload = true;
      }
      continue;
    }

    if (line.startsWith("T ")) {
      const parts: string[] = line.slice(2).trim().split(/\s+/);
      if (parts.length < 2) {
        throw new Error(`Invalid T record: ${line}`);
      }
      const addr: number = Number.parseInt(parts[0]!, 16);
      const len: number = Number.parseInt(parts[1]!, 16);
      const data: string[] = parts.slice(2);
      if (data.length !== len) {
        throw new Error(
          `T record length mismatch: expected ${len}, got ${data.length}`,
        );
      }
      for (let i = 0; i < data.length; i += 1) {
        current.code.set(addr + i, Number.parseInt(data[i]!, 16) & 0xff);
      }
      current.size = Math.max(current.size, addr + data.length);
      continue;
    }

    if (line.startsWith("S ")) {
      const m = line.match(
        /^S\s+(\S+)\s+(Def|Ref)([0-9A-Fa-f]+)(?:\s+(\S+))?$/i,
      );
      if (!m) throw new Error(`Invalid S record: ${line}`);
      const name: string = m[1]!.toUpperCase();
      const kind: string = m[2]!.toLowerCase();
      const val: number = Number.parseInt(m[3]!, 16);
      if (kind === "def") {
        const area = canonicalAreaName(m[4] ?? current.name);
        ensureArea(areas, byName, area);
        defs.set(name, { offset: val, area });
      } else {
        refs.add(name);
      }
      continue;
    }

    if (line.startsWith("W ")) {
      const m = line.match(
        /^W\s+([0-9A-Fa-f]+)\s+(=[0-9A-Fa-f]+|#(?:[A-Za-z_][A-Za-z0-9_]*:)?[0-9A-Fa-f]+|[A-Za-z_.$][A-Za-z0-9_.$]*)-(=[0-9A-Fa-f]+|#(?:[A-Za-z_][A-Za-z0-9_]*:)?[0-9A-Fa-f]+|[A-Za-z_.$][A-Za-z0-9_.$]*)$/i,
      );
      if (!m) throw new Error(`Invalid W record: ${line}`);
      relocs.push({
        byteAddr: Number.parseInt(m[1]!, 16),
        left: parseRelocOperand(m[2]!),
        right: parseRelocOperand(m[3]!),
        area: current.name,
      });
      continue;
    }

    // XH2 / H / E などは無視
  }

  if (areas.length === 0) {
    ensureArea(areas, byName, "_CODE");
  }

  return { moduleName, areas, defs, refs, relocs };
}
