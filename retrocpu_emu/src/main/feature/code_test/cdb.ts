/**
 * SDCC CDB パーサ（ラベル解決用）
 * 根拠: .cursor/rules/emulater_code_test.mdc / SDCC cdbfileformat
 *
 * 当面は L: リンクレコードを中心に扱う。
 * アドレスはバイトアドレスとして解釈する。
 */

import type { CdbSymbol } from "./types";

export type CdbTable = {
  /** 名前 → シンボル（同名は後勝ち。グローバル優先で上書き） */
  byName: Map<string, CdbSymbol>;
  symbols: CdbSymbol[];
};

/**
 * CDB テキストをパースする。
 * 対応: L:G$name$level$block:addr / L:F$... / L:L$...
 */
export function parseCdb(cdbText: string): CdbTable {
  const byName = new Map<string, CdbSymbol>();
  const symbols: CdbSymbol[] = [];

  const lines = cdbText.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[1] !== ":") continue;
    const kind = line[0];
    if (kind !== "L") continue;

    // L:G$name$0$0:1A2B
    const body = line.slice(2);
    const colon = body.lastIndexOf(":");
    if (colon < 0) continue;
    const left = body.slice(0, colon);
    const addrHex = body.slice(colon + 1).trim();
    if (!/^[0-9A-Fa-f]+$/.test(addrHex)) continue;

    const parts = left.split("$");
    if (parts.length < 2) continue;
    const scope = parts[0]!;
    const name = parts[1]!;
    if (!name) continue;

    const byteAddr = parseInt(addrHex, 16) >>> 0;
    if (byteAddr % 2 !== 0) {
      throw new Error(
        `CDB symbol "${name}" has odd byte address 0x${addrHex} (MN1613 expects even)`,
      );
    }
    const sym: CdbSymbol = {
      name,
      byteAddr,
      wordAddr: byteAddr >>> 1,
      scope,
    };
    symbols.push(sym);
    // G は常に登録。F/L は未登録時のみ（後から G で上書き可）
    const prev = byName.get(name);
    if (!prev || scope === "G" || prev.scope !== "G") {
      byName.set(name, sym);
    }
  }

  return { byName, symbols };
}

export function requireSymbol(table: CdbTable, name: string): CdbSymbol {
  const s = table.byName.get(name);
  if (!s) {
    throw new Error(`CDB symbol not found: ${name}`);
  }
  return s;
}
