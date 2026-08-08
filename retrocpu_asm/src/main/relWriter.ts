import type { AssemblyResult, RelocOperand } from "./types";
import {
  AREA_FLAG_NOLOAD,
  canonicalAreaName,
  orderLinkAreaNames,
} from "./areaOrder";

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
 * リロケーションオペランドを W レコード用文字列にする。
 * @param op - オペランド
 * @return シンボル名または #XXXX
 */
function formatRelocOperand(op: RelocOperand): string {
  if (op.kind === "symbol") return op.name;
  if (op.kind === "const") return `=${hex4(op.value)}`;
  if (op.area) {
    return `#${canonicalAreaName(op.area)}:${hex4(op.value)}`;
  }
  return `#${hex4(op.value)}`;
}

/**
 * アドレス単位をバイト数にする。
 * @param units - ワード数（MN161x）またはバイト数（TMS）
 * @param byteAddrs - TMS なら true
 * @returns バイト数
 */
function unitsToBytes(units: number, byteAddrs: boolean): number {
  return byteAddrs ? units : units * 2;
}

/**
 * アセンブル結果をREL形式テキストに変換する。
 * 領域は `_CODE` → `_DATA` → `_WORK` の順で A レコードを出す。
 * MN161x: EmittedWord.address はワード、REL のバイトアドレスは ×2。
 * TMS9995: EmittedWord.address はバイトのまま。
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

  const lines: string[] = [];
  lines.push("XH2");

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
  ]);
  const areaByName = new Map(result.areas.map((a) => [a.name, a]));
  for (const w of result.words) {
    const key = canonicalAreaName(w.area);
    if (!areaByName.has(key)) {
      areaByName.set(key, { name: key, size: 0, noload: key === "_WORK" });
    }
  }
  if (areaNames.length === 0) areaNames.push("_CODE");

  lines.push(
    `H ${hex4(areaNames.length)} areas ${hex4(globalEntries.length)} global symbols`,
  );
  lines.push(`M ${moduleName}`);

  const wordsOf = (area: string) =>
    result.words
      .filter((w) => canonicalAreaName(w.area) === area)
      .sort((a, b) => a.address - b.address);

  const relocsOf = (area: string) =>
    result.relocs
      .filter((r) => canonicalAreaName(r.area ?? "_CODE") === area)
      .sort((a, b) => {
        if (a.byteAddr !== b.byteAddr) return a.byteAddr - b.byteAddr;
        return (
          formatRelocOperand(a.left).localeCompare(formatRelocOperand(b.left)) ||
          formatRelocOperand(a.right).localeCompare(formatRelocOperand(b.right))
        );
      });

  for (const areaName of areaNames) {
    const info = areaByName.get(areaName);
    const sorted = wordsOf(areaName);
    const maxAddr =
      sorted.length === 0
        ? -1
        : sorted.reduce((m, w) => Math.max(m, w.address), 0);
    const fromWords =
      maxAddr < 0 ? 0 : byteAddrs ? maxAddr + 2 : (maxAddr + 1) * 2;
    const fromInfo = info ? unitsToBytes(info.size, byteAddrs) : 0;
    const sizeBytes = Math.max(fromWords, fromInfo);
    const noload = info?.noload === true || areaName === "_WORK";
    const flags = noload ? AREA_FLAG_NOLOAD : 0;
    lines.push(
      `A ${areaName} size ${hex4(sizeBytes)} flags ${hex4(flags)}`,
    );

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
        const chunkWords = Math.min(8, runEnd - p + 1);
        const firstAddr = sorted[p]!.address;
        const byteAddr = byteAddrs ? firstAddr : firstAddr * 2;
        const bytes: number[] = [];
        for (let i = 0; i < chunkWords; i += 1) {
          const w = sorted[p + i]!.value & 0xffff;
          bytes.push((w >> 8) & 0xff, w & 0xff);
        }
        lines.push(
          `T ${hex4(byteAddr)} ${hex2(bytes.length)} ${bytes.map(hex2).join(" ")}`,
        );
        p += chunkWords;
      }

      idx = runEnd + 1;
    }

    for (const g of globalEntries) {
      if (!g.def) continue;
      const gArea = canonicalAreaName(g.area ?? "_CODE");
      if (gArea !== areaName) continue;
      const defBytes = byteAddrs ? g.value : g.value * 2;
      const suffix = gArea === "_CODE" ? "" : ` ${gArea}`;
      lines.push(`S ${g.name} Def${hex4(defBytes)}${suffix}`);
    }

    for (const r of relocsOf(areaName)) {
      lines.push(
        `W ${hex4(r.byteAddr)} ${formatRelocOperand(r.left)}-${formatRelocOperand(r.right)}`,
      );
    }
  }

  for (const g of globalEntries) {
    if (!g.def) {
      lines.push(`S ${g.name} Ref0000`);
    }
  }

  lines.push("E");
  return lines.join("\n") + "\n";
}
