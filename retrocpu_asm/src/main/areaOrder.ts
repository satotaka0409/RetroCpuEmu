/**
 * リンク時の CON 領域順。
 * `_VECTOR` があれば先頭。続けてゼロページ、`_CODE` → `_DATA` → `_WORK`。
 * それ以外の名前はアルファベット順で後ろへ。
 */
export const AREA_LINK_ORDER: readonly string[] = [
  "_VECTOR",
  "_SYS_PAGE0",
  "_USR_PAGE0",
  "_CODE",
  "_DATA",
  "_WORK",
];

/** `_SYS_PAGE0` 開始ワード（割り込み退避 0000–0007 の次） */
export const SYS_PAGE0_WORD_BASE = 0x0008;

/** `_USR_PAGE0` 開始ワード */
export const USR_PAGE0_WORD_BASE = 0x0040;

/**
 * ゼロページ領域の開始ワード。該当しなければ undefined。
 * リンカはここから CON 連結し、イメージ cursor は進めない。
 * @param name - `.area` 名
 * @returns 開始ワードアドレス
 */
export function page0WordBase(name: string): number | undefined {
  const n = canonicalAreaName(name);
  if (n === "_SYS_PAGE0") return SYS_PAGE0_WORD_BASE;
  if (n === "_USR_PAGE0") return USR_PAGE0_WORD_BASE;
  return undefined;
}

/** 旧 REL の NOLOAD ビット（asxxxx A3 では使わない） */
export const AREA_FLAG_NOLOAD = 0x0010;

/** asxxxx XH2 A3_OVR（overlay） */
export const A3_OVR = 0x04;

/** asxxxx XH2 A3_ABS */
export const A3_ABS = 0x08;

/**
 * sdld `-b` 用の領域開始（asxxxx バイトアドレス）。
 * `_VECTOR` / `_CODE` は 0。main.rel の `.org`（ワード×2）が原点になる。
 */
export const SDLD_AREA_BASES: Readonly<Record<string, number>> = {
  _SYS_PAGE0: SYS_PAGE0_WORD_BASE * 2,
  _USR_PAGE0: USR_PAGE0_WORD_BASE * 2,
  _VECTOR: 0,
  _CODE: 0,
};

/**
 * asxxxx A レコードの flags。`_VECTOR` は overlay（他領域の cursor を進めない）。
 * @param name 領域名
 * @param noload NOLOAD なら true（IHX に出さない。T が無ければ flags は 0 で足りる）
 * @returns A3 flags
 */
export function asxxxxAreaFlags(name: string, noload: boolean): number {
  const n = canonicalAreaName(name);
  let flags = 0;
  if (n === "_VECTOR") flags |= A3_OVR;
  void noload;
  return flags;
}

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
 * @returns `_VECTOR` → ゼロページ → `_CODE` → `_DATA` → `_WORK` を優先した配列
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
