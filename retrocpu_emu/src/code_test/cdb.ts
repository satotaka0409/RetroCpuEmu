/**
 * SDCC CDB パーサ（ラベル解決用）
 * 根拠: .cursor/rules/emulater_code_test.mdc / SDCC cdbfileformat
 *
 * 当面は L: リンクレコードを中心に扱う。
 * アドレスはバイトアドレスとして解釈する。
 */

import type { CdbCheckpoint, CdbSymbol } from "./types";

/** `L:__CP$uart_initialized$0001` の `$` 区切り本体 */
const CP_LEFT = /^__CP\$([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})$/;

export type CdbTable = {
  /** 名前 → シンボル（同名は後勝ち。グローバル優先で上書き） */
  byName: Map<string, CdbSymbol>;
  symbols: CdbSymbol[];
  /** `; @cp` チェックポイント（ラベルではない。byName には載せない） */
  checkpoints: CdbCheckpoint[];
};

/**
 * 空の CDB 表を作る。
 * @returns シンボル／チェックポイントなし
 */
export function emptyCdbTable(): CdbTable {
  return { byName: new Map(), symbols: [], checkpoints: [] };
}

/**
 * CDB テキストをパースする。
 * 対応: L:G$name$level$block:addr / L:F$... / L:L$... /
 * L:__CP$checkpoint$serial:addr および L:G$__CP$...（チェックポイント。ラベル表には混ぜない）
 */
export function parseCdb(cdbText: string): CdbTable {
  const byName = new Map<string, CdbSymbol>();
  const symbols: CdbSymbol[] = [];
  const checkpoints: CdbCheckpoint[] = [];

  const lines = cdbText.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[1] !== ":") continue;
    const kind = line[0];
    if (kind !== "L") continue;

    // L:G$name$0$0:1A2B  /  L:__CP$uart_initialized$0001:812A
    const body = line.slice(2);
    const colon = body.lastIndexOf(":");
    if (colon < 0) continue;
    const left = body.slice(0, colon);
    const addrHex = body.slice(colon + 1).trim();
    if (!/^[0-9A-Fa-f]+$/.test(addrHex)) continue;

    const byteAddr = parseInt(addrHex, 16) >>> 0;
    if (byteAddr % 2 !== 0) {
      throw new Error(
        `CDB record "${left}" has odd byte address 0x${addrHex} (MN1613 expects even)`,
      );
    }

    const cpLeft = left.startsWith("G$") ? left.slice(2) : left;
    const cpMatch = cpLeft.match(CP_LEFT);
    if (cpMatch) {
      const name = cpMatch[1]!;
      const serial = cpMatch[2]!;
      checkpoints.push({
        id: `__CP$${name}$${serial}`,
        name,
        serial,
        byteAddr,
        wordAddr: byteAddr >>> 1,
      });
      continue;
    }

    const parts = left.split("$");
    if (parts.length < 2) continue;
    const scope = parts[0]!;
    const namePart = parts[1]!;
    if (!namePart) continue;

    const sym: CdbSymbol = {
      name: namePart,
      byteAddr,
      wordAddr: byteAddr >>> 1,
      scope,
    };
    symbols.push(sym);
    // G は常に登録。F/L は未登録時のみ（後から G で上書き可）
    const prev = byName.get(namePart);
    if (!prev || scope === "G" || prev.scope !== "G") {
      byName.set(namePart, sym);
    }
  }

  return { byName, symbols, checkpoints };
}

/**
 * ワードアドレス → チェックポイント ID。同一ワードは `,` で連結する。
 * @param table parseCdb() の結果
 * @returns ワードアドレス → `__CP$name$serial`（複数なら連結）
 */
export function checkpointIdsByWordAddr(table: CdbTable): Map<number, string> {
  const map = new Map<number, string>();
  for (const cp of table.checkpoints) {
    const addr = cp.wordAddr & 0xffff;
    const prev = map.get(addr);
    map.set(addr, prev ? `${prev},${cp.id}` : cp.id);
  }
  return map;
}

/**
 * シンボルを名前で引く。
 * @param table parseCdb() の結果
 * @param name ラベル名
 * @returns 見つかったシンボル
 * @throws 未登録の場合
 */
export function requireSymbol(table: CdbTable, name: string): CdbSymbol {
  const s = table.byName.get(name);
  if (!s) {
    throw new Error(`CDB symbol not found: ${name}`);
  }
  return s;
}
