import type { RelocOperand, WordDiffReloc } from "./types";

/** パースした REL モジュール */
export interface RelModule {
  moduleName: string;
  /** _CODE サイズ（バイト） */
  codeSize: number;
  /** バイトアドレス → データバイト */
  code: Map<number, number>;
  /** グローバル定義（バイトアドレス） */
  defs: Map<string, number>;
  /** 外部参照名 */
  refs: Set<string>;
  /** ワード差リロケーション */
  relocs: WordDiffReloc[];
}

/**
 * W レコードのオペランド文字列をパースする。
 * @param token - シンボル名または #XXXX
 * @return RelocOperand
 */
function parseRelocOperand(token: string): RelocOperand {
  if (token.startsWith("#")) {
    return { kind: "word", value: Number.parseInt(token.slice(1), 16) & 0xffff };
  }
  return { kind: "symbol", name: token.toUpperCase() };
}

/**
 * REL 形式テキストをパースする。
 * @param text - .rel ファイル内容
 * @return パース結果モジュール
 */
export function parseRel(text: string): RelModule {
  const lines: string[] = text.replace(/\r\n/g, "\n").split("\n");
  let moduleName = "MN1610";
  let codeSize = 0;
  const code: Map<number, number> = new Map();
  const defs: Map<string, number> = new Map();
  const refs: Set<string> = new Set();
  const relocs: WordDiffReloc[] = [];

  for (const raw of lines) {
    const line: string = raw.trim();
    if (!line) continue;

    if (line.startsWith("M ")) {
      moduleName = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("A ")) {
      // A _CODE size XXXX flags YYYY
      const m = line.match(/A\s+\S+\s+size\s+([0-9A-Fa-f]+)/i);
      if (m) codeSize = Number.parseInt(m[1], 16);
      continue;
    }

    if (line.startsWith("T ")) {
      const parts: string[] = line.slice(2).trim().split(/\s+/);
      if (parts.length < 2) {
        throw new Error(`Invalid T record: ${line}`);
      }
      const addr: number = Number.parseInt(parts[0], 16);
      const len: number = Number.parseInt(parts[1], 16);
      const data: string[] = parts.slice(2);
      if (data.length !== len) {
        throw new Error(
          `T record length mismatch: expected ${len}, got ${data.length}`,
        );
      }
      for (let i = 0; i < data.length; i += 1) {
        code.set(addr + i, Number.parseInt(data[i], 16) & 0xff);
      }
      continue;
    }

    if (line.startsWith("S ")) {
      const m = line.match(/^S\s+(\S+)\s+(Def|Ref)([0-9A-Fa-f]+)$/i);
      if (!m) throw new Error(`Invalid S record: ${line}`);
      const name: string = m[1].toUpperCase();
      const kind: string = m[2].toLowerCase();
      const val: number = Number.parseInt(m[3], 16);
      if (kind === "def") {
        defs.set(name, val);
      } else {
        refs.add(name);
      }
      continue;
    }

    if (line.startsWith("W ")) {
      const m = line.match(
        /^W\s+([0-9A-Fa-f]+)\s+(#[0-9A-Fa-f]+|[A-Za-z_.$][A-Za-z0-9_.$]*)-(#[0-9A-Fa-f]+|[A-Za-z_.$][A-Za-z0-9_.$]*)$/i,
      );
      if (!m) throw new Error(`Invalid W record: ${line}`);
      relocs.push({
        byteAddr: Number.parseInt(m[1], 16),
        left: parseRelocOperand(m[2]),
        right: parseRelocOperand(m[3]),
      });
      continue;
    }

    // XH2 / H / E などは無視
  }

  return { moduleName, codeSize, code, defs, refs, relocs };
}
