import type { AssemblyResult, WordDiffReloc } from "./types";
import { checkpointId } from "./checkpoint";
import {
  asxxxxAreaFlags,
  canonicalAreaName,
  orderLinkAreaNames,
} from "./areaOrder";

/** sdld XH2: アドレス 2 バイト + データ最大 14 バイト（NTXT=16） */
const MAX_T_DATA_BYTES = 14;

/** R3_WORD | R3_AREA */
const R3_WORD_AREA = 0x00;
/** R3_WORD | R3_SYM */
const R3_WORD_SYM = 0x02;
/** R3_BYTE | R3_AREA */
const R3_BYTE_AREA = 0x01;
/** R3_BYTE | R3_SYM */
const R3_BYTE_SYM = 0x03;

/**
 * 数値を2桁ゼロ埋め16進文字列に変換する。
 * @param v 数値
 * @return 2桁ゼロ埋め16進文字列
 */
function hex2(v: number): string {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

/**
 * 数値を4桁ゼロ埋め16進文字列に変換する。
 * @param v 数値
 * @return 4桁ゼロ埋め16進文字列
 */
function hex4(v: number): string {
  return (v & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * sdld の領域シンボル名（`s__WORK`）。アセンブラ内部は大文字 `S__WORK`。
 * @param name 内部シンボル名
 * @returns REL に出す名前
 */
function sdldSymName(name: string): string {
  if (/^[SL]__/.test(name)) {
    return `${name[0]!.toLowerCase()}${name.slice(1)}`;
  }
  return name;
}

/**
 * アドレス単位を asxxxx バイトアドレスにする。
 * MN161x はワード×2。TMS はそのまま。
 * @param units アセンブラのアドレス
 * @param byteAddrs TMS なら true
 * @returns REL の T/A/S に出す値
 */
function unitsToRelAddr(units: number, byteAddrs: boolean): number {
  return byteAddrs ? units : (units * 2) & 0xffff;
}

/**
 * 領域サイズを asxxxx バイト数にする。
 * @param sizeUnits アセンブラのサイズ（MN161x ワード / TMS バイト）
 * @param byteAddrs TMS なら true
 * @returns A レコード size
 */
function areaSizeRel(sizeUnits: number, byteAddrs: boolean): number {
  return byteAddrs ? sizeUnits : (sizeUnits * 2) & 0xffff;
}

/**
 * asxxxx の 2 バイト（ビッグエンディアン）を空白区切りで出す。
 * @param v 16bit
 * @returns `HH LL`
 */
function beWord(v: number): string {
  return `${hex2((v >> 8) & 0xff)} ${hex2(v & 0xff)}`;
}

/**
 * リロケーションを asxxxx R アイテム（mode, rtp, index）にする。
 * 単純な絶対アドレス（symbol または area+offset）だけ対応。差はアセンブル時エラー。
 * @param r リロケーション
 * @param rtp T 行内のバイト索引（アドレス 2 バイトを含む）
 * @param areaIndexByName 領域名 → A レコード順
 * @param symIndexByName グローバル名 → S 順
 * @returns mode/rtp/index。非対応なら null
 */
function relocItem(
  r: WordDiffReloc,
  rtp: number,
  areaIndexByName: Map<string, number>,
  symIndexByName: Map<string, number>,
): { mode: number; rtp: number; index: number } | null {
  if (r.right.kind !== "const" || r.right.value !== 0) {
    return null;
  }
  const low8 = r.width === "low8";
  if (r.left.kind === "symbol") {
    const idx = symIndexByName.get(r.left.name);
    if (idx === undefined) return null;
    return { mode: low8 ? R3_BYTE_SYM : R3_WORD_SYM, rtp, index: idx };
  }
  if (r.left.kind === "word") {
    const area = canonicalAreaName(r.left.area ?? r.area ?? "_CODE");
    const idx = areaIndexByName.get(area);
    if (idx === undefined) return null;
    return { mode: low8 ? R3_BYTE_AREA : R3_WORD_AREA, rtp, index: idx };
  }
  return null;
}

/**
 * アセンブル結果を sdld が読む asxxxx XH2 REL にする。
 * T/A/S はバイトアドレス（MN161x はワード×2）。命令のアドレス欄は
 * リンク後に `linkRelsWithSdld` が ÷2 してワードへ戻す。
 * TMS9995: バイトのまま（÷2 しない）。
 * @param result アセンブル結果
 * @param moduleName モジュール名（省略時は "MN1610"）
 * @return REL形式テキスト
 */
export function writeRel(
  result: AssemblyResult,
  moduleName = "MN1610",
): string {
  const byteAddrs = result.addressUnit === "byte";
  const addrStep = byteAddrs ? 2 : 1;

  const globalEntries: Array<{
    name: string;
    def: boolean;
    value: number;
    area?: string;
  }> = [];
  for (const [name, info] of result.symbolInfos.entries()) {
    if (info.kind === "global") {
      globalEntries.push({
        name,
        def: true,
        value: info.value,
        area: info.area ? canonicalAreaName(info.area) : "_CODE",
      });
    } else if (info.kind === "external") {
      globalEntries.push({ name, def: false, value: 0 });
    }
  }
  globalEntries.sort((a, b) => a.name.localeCompare(b.name));

  const areaNames: string[] = orderLinkAreaNames([
    ...result.areas.map((a) => a.name),
    ...result.words.map((w) => w.area),
    ...globalEntries.filter((g) => g.def && g.area).map((g) => g.area!),
    ...(result.checkpoints ?? []).map((c) => c.area),
  ]);
  const areaByName = new Map(result.areas.map((a) => [a.name, a]));
  for (const w of result.words) {
    const key = canonicalAreaName(w.area);
    if (!areaByName.has(key)) {
      areaByName.set(key, { name: key, size: 0, noload: key === "_WORK" });
    }
  }
  if (areaNames.length === 0) areaNames.push("_CODE");

  const areaIndexByName = new Map<string, number>();
  areaNames.forEach((n, i) => areaIndexByName.set(n, i));

  const cpEntries = (result.checkpoints ?? []).map((cp) => ({
    name: checkpointId(cp.name, cp.serial),
    value: unitsToRelAddr(cp.address, byteAddrs),
    area: canonicalAreaName(cp.area),
  }));

  const absName = ".__.ABS.";
  const symIndexByName = new Map<string, number>();
  let symN = 0;
  symIndexByName.set(absName, symN++);
  const refs = globalEntries.filter((g) => !g.def);
  for (const g of refs) {
    symIndexByName.set(g.name, symN++);
  }
  for (const areaName of areaNames) {
    for (const g of globalEntries) {
      if (!g.def) continue;
      if (canonicalAreaName(g.area ?? "_CODE") !== areaName) continue;
      symIndexByName.set(g.name, symN++);
    }
    for (const cp of cpEntries) {
      if (cp.area !== areaName) continue;
      symIndexByName.set(cp.name, symN++);
    }
  }

  const lines: string[] = [];
  lines.push("XH2");
  lines.push(
    `H ${areaNames.length.toString(16).toUpperCase()} areas ${symN.toString(16).toUpperCase()} global symbols`,
  );
  lines.push(`M ${moduleName}`);
  lines.push(`S ${absName} Def0000`);
  for (const g of refs) {
    lines.push(`S ${sdldSymName(g.name)} Ref0000`);
  }

  const wordsOf = (area: string) =>
    result.words
      .filter((w) => canonicalAreaName(w.area) === area)
      .sort((a, b) => a.address - b.address);

  const relocsOf = (area: string) =>
    result.relocs.filter(
      (r) => canonicalAreaName(r.area ?? "_CODE") === area,
    );

  for (const areaName of areaNames) {
    const info = areaByName.get(areaName);
    const sorted = wordsOf(areaName);
    const maxAddr =
      sorted.length === 0
        ? -1
        : sorted.reduce((m, w) => Math.max(m, w.address), 0);
    const fromWords =
      maxAddr < 0 ? 0 : byteAddrs ? maxAddr + 2 : maxAddr + 1;
    const fromInfo = info ? areaSizeRel(info.size, byteAddrs) : 0;
    const sizeRel = Math.max(fromWords, fromInfo);
    const noload = info?.noload === true || areaName === "_WORK";
    const flags = asxxxxAreaFlags(areaName, noload);
    lines.push(
      `A ${areaName} size ${hex4(sizeRel)} flags ${hex4(flags)} addr 0`,
    );

    for (const g of globalEntries) {
      if (!g.def) continue;
      if (canonicalAreaName(g.area ?? "_CODE") !== areaName) continue;
      const defRel = unitsToRelAddr(g.value, byteAddrs);
      lines.push(`S ${sdldSymName(g.name)} Def${hex4(defRel)}`);
    }
    for (const cp of cpEntries) {
      if (cp.area !== areaName) continue;
      lines.push(`S ${cp.name} Def${hex4(cp.value)}`);
    }

    const areaIdx = areaIndexByName.get(areaName) ?? 0;
    const areaRelocs = relocsOf(areaName);

    let idx = 0;
    while (idx < sorted.length) {
      const runStart = idx;
      let runEnd = idx;
      while (
        runEnd + 1 < sorted.length &&
        sorted[runEnd + 1]!.address === sorted[runEnd]!.address + addrStep
      ) {
        runEnd += 1;
      }

      let p = runStart;
      while (p <= runEnd) {
        const maxWords = Math.floor(MAX_T_DATA_BYTES / 2);
        const chunkWords = Math.min(maxWords, runEnd - p + 1);
        const firstAddr = sorted[p]!.address;
        const relAddr = unitsToRelAddr(firstAddr, byteAddrs);
        const bytes: number[] = [];
        for (let i = 0; i < chunkWords; i += 1) {
          const w = sorted[p + i]!.value & 0xffff;
          bytes.push((w >> 8) & 0xff, w & 0xff);
        }
        const startByte = byteAddrs ? firstAddr : firstAddr * 2;
        const endByte = startByte + bytes.length;
        lines.push(`T ${beWord(relAddr)} ${bytes.map(hex2).join(" ")}`);

        const items: string[] = [];
        for (const r of areaRelocs) {
          if (r.byteAddr < startByte || r.byteAddr >= endByte) continue;
          const rtp = 2 + (r.byteAddr - startByte);
          const item = relocItem(r, rtp, areaIndexByName, symIndexByName);
          if (!item) {
            throw new Error(
              `unsupported reloc at ${hex4(r.byteAddr)} in ${areaName} (sdld needs a single absolute symbol or area)`,
            );
          }
          items.push(
            `${hex2(item.mode)} ${hex2(item.rtp)} ${beWord(item.index)}`,
          );
        }
        lines.push(`R ${beWord(R3_WORD_AREA)} ${beWord(areaIdx)}${items.length ? ` ${items.join(" ")}` : ""}`);
        p += chunkWords;
      }

      idx = runEnd + 1;
    }
  }

  lines.push("E");
  return lines.join("\n") + "\n";
}
