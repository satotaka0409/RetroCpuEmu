/**
 * TMS9995 向け CDB パーサ。
 * MN1613 の `parseCdb` は奇数バイトアドレスを拒否するため、バイト CPU では本関数を使う。
 * レコード形式は SDCC CDB（L:）と同じ。
 */

import type { CdbCheckpoint, CdbSymbol } from "../../../retrocpu_emu/src/code_test/types.js";
import type { CdbTable } from "../../../retrocpu_emu/src/code_test/cdb.js";

/** `L:__CP$uart_initialized$0001` の `$` 区切り本体 */
const CP_LEFT = /^__CP\$([A-Za-z_][A-Za-z0-9_]*)\$([0-9]{4})$/;

/**
 * 空の CDB 表を作る。
 * @returns シンボル／チェックポイントなし
 */
export function emptyTms9995CdbTable(): CdbTable {
  return { byName: new Map(), symbols: [], checkpoints: [] };
}

/**
 * CDB テキストをパースする（奇数バイトアドレス可）。
 * @param cdbText CDB 全文
 * @returns ラベル表とチェックポイント
 */
export function parseTms9995Cdb(cdbText: string): CdbTable {
  const byName = new Map<string, CdbSymbol>();
  const symbols: CdbSymbol[] = [];
  const checkpoints: CdbCheckpoint[] = [];

  const lines = cdbText.replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[1] !== ":") continue;
    if (line[0] !== "L") continue;

    const body = line.slice(2);
    const colon = body.lastIndexOf(":");
    if (colon < 0) continue;
    const left = body.slice(0, colon);
    const addrHex = body.slice(colon + 1).trim();
    if (!/^[0-9A-Fa-f]+$/.test(addrHex)) continue;

    const byteAddr = parseInt(addrHex, 16) >>> 0;

    const cpLeft = left.startsWith("G$") ? left.slice(2) : left;
    if (cpLeft.startsWith("__CP$")) {
      const cpMatch = cpLeft.match(CP_LEFT);
      if (!cpMatch) {
        throw new Error(`Invalid checkpoint CDB record "${left}"`);
      }
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
    const prev = byName.get(namePart);
    if (!prev || scope === "G" || prev.scope !== "G") {
      byName.set(namePart, sym);
    }
  }

  return { byName, symbols, checkpoints };
}

/**
 * シンボルを名前で引く（大文字小文字無視）。
 * @param table parseTms9995Cdb の結果
 * @param name ラベル名
 * @returns 見つかったシンボル
 * @throws 未登録の場合
 */
export function requireTms9995Symbol(
  table: CdbTable,
  name: string,
): CdbSymbol {
  const exact = table.byName.get(name);
  if (exact) return exact;
  const upper = name.toUpperCase();
  for (const [k, v] of table.byName) {
    if (k.toUpperCase() === upper) return v;
  }
  throw new Error(`CDB symbol not found: ${name}`);
}
