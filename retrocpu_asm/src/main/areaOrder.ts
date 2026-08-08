/**
 * リンク時の CON 領域順。
 * `_VECTOR` があれば先頭。続けて `_CODE` → `_DATA` → `_WORK`。
 * それ以外の名前はアルファベット順で後ろへ。
 */
export const AREA_LINK_ORDER: readonly string[] = [
  "_VECTOR",
  "_CODE",
  "_DATA",
  "_WORK",
];

/** NOLOAD を表す A レコード flags ビット */
export const AREA_FLAG_NOLOAD = 0x0010;

/**
 * 無名領域を `_CODE` とみなす。
 * @param name - `.area` 名
 * @returns 正規化名
 */
export function canonicalAreaName(name: string): string {
  const u: string = name.trim().toUpperCase();
  return u === "" ? "_CODE" : u;
}

/**
 * リンク／REL 出力用に領域名を並べる。
 * @param names - 領域名
 * @returns `_CODE` → `_DATA` → `_WORK` を優先した配列
 */
export function orderLinkAreaNames(names: Iterable<string>): string[] {
  const set: Set<string> = new Set(
    [...names].map(canonicalAreaName).filter((n) => n.length > 0),
  );
  const out: string[] = [];
  for (const n of AREA_LINK_ORDER) {
    if (set.has(n)) {
      out.push(n);
      set.delete(n);
    }
  }
  out.push(...[...set].sort());
  return out;
}
