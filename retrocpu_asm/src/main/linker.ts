import type { RelocOperand } from "./types";
import { canonicalAreaName, orderLinkAreaNames } from "./areaOrder";
import { parseRel, type RelModule } from "./relParser";

/** リンク結果 */
export interface LinkResult {
  /** 結合後のメモリイメージ（バイト） */
  image: Uint8Array;
  /** 解決済みグローバル定義（バイトアドレス） */
  defs: Map<string, number>;
}

/**
 * パスの basename を小文字で返す（`/` `\` 両対応）。
 * @param relPath - .rel ファイルパス
 * @returns basename（小文字）
 */
function relBasenameLower(relPath: string): string {
  const norm: string = relPath.replace(/\\/g, "/");
  const i: number = norm.lastIndexOf("/");
  return (i < 0 ? norm : norm.slice(i + 1)).toLowerCase();
}

/**
 * 入力 .rel のうち `main.rel` を必ず先頭にする。
 * 無い・複数ある場合はエラー（引数順に依存しない）。
 * @param relPaths - リンク対象パス（任意順）
 * @returns main.rel を先頭にしたパス配列
 * @throws main.rel が無い、または複数ある
 */
export function orderRelPathsMainFirst(relPaths: string[]): string[] {
  const mains: string[] = [];
  const others: string[] = [];
  for (const p of relPaths) {
    if (relBasenameLower(p) === "main.rel") {
      mains.push(p);
    } else {
      others.push(p);
    }
  }
  if (mains.length === 0) {
    throw new Error("main.rel must be linked first (include main.rel in the inputs)");
  }
  if (mains.length > 1) {
    throw new Error(`multiple main.rel inputs: ${mains.join(", ")}`);
  }
  return [mains[0]!, ...others];
}

/**
 * モジュール名 `MAIN` を先頭に並べる。無ければ元の順のまま。
 * @param modules - パース済みモジュール
 * @returns MAIN を先頭にした配列
 * @throws MAIN が複数ある
 */
export function orderModulesMainFirst(modules: RelModule[]): RelModule[] {
  const mains: RelModule[] = [];
  const others: RelModule[] = [];
  for (const m of modules) {
    if (m.moduleName.toUpperCase() === "MAIN") {
      mains.push(m);
    } else {
      others.push(m);
    }
  }
  if (mains.length > 1) {
    throw new Error("Duplicate MAIN module");
  }
  if (mains.length === 1) {
    return [mains[0]!, ...others];
  }
  return modules;
}

/**
 * リロケーションオペランドを絶対ワードアドレスに解決する。
 * @param op - オペランド（symbol / word=領域相対 / const=絶対定数）
 * @param defs - グローバル Def（バイト）
 * @param areaWordBase - このモジュール・領域の絶対ワード基準
 * @return ワードアドレス
 */
function resolveOperand(
  op: RelocOperand,
  defs: Map<string, number>,
  areaWordBase: number,
): number {
  if (op.kind === "const") {
    return op.value & 0xffff;
  }
  if (op.kind === "word") {
    return (areaWordBase + op.value) & 0xffff;
  }
  const byteAddr: number | undefined = defs.get(op.name);
  if (byteAddr === undefined) {
    throw new Error(`Unresolved symbol in W record: ${op.name}`);
  }
  return Math.trunc(byteAddr / 2) & 0xffff;
}

/**
 * 複数の REL テキストをリンクする。
 * 領域は `_CODE` → `_DATA` → `_WORK` の順で CON 連結する。
 * モジュール名 `MAIN` があれば必ず先頭に置く。
 * @param relTexts - .rel ファイル内容の配列（リンク順。MAIN は自動で先頭へ）
 * @return リンク結果
 */
export function linkRelTexts(relTexts: string[]): LinkResult {
  const modules: RelModule[] = relTexts.map(parseRel);
  return linkModules(modules);
}

/**
 * パース済みモジュールをリンクする。
 * 領域順 `_CODE` → `_DATA` → `_WORK`。モジュール名 `MAIN` は先頭。
 * @param modules - モジュール配列
 * @return リンク結果
 */
export function linkModules(modules: RelModule[]): LinkResult {
  const ordered: RelModule[] = orderModulesMainFirst(modules);
  if (ordered.length === 0) {
    return { image: new Uint8Array(0), defs: new Map() };
  }

  const allAreaNames: string[] = [];
  for (const mod of ordered) {
    for (const a of mod.areas) allAreaNames.push(a.name);
    for (const d of mod.defs.values()) allAreaNames.push(d.area);
  }
  const areaOrder: string[] = orderLinkAreaNames(allAreaNames);

  const imageBytes: number[] = [];
  /** `${modIndex}\0${area}` → バイト基底 */
  const modAreaBase: Map<string, number> = new Map();
  let cursor = 0;

  for (const areaName of areaOrder) {
    for (let mi = 0; mi < ordered.length; mi += 1) {
      const mod = ordered[mi]!;
      const area = mod.areas.find(
        (a) => canonicalAreaName(a.name) === areaName,
      );
      if (!area) continue;
      const base = cursor;
      modAreaBase.set(`${mi}\0${areaName}`, base);
      if (!area.noload) {
        while (imageBytes.length < base + area.size) imageBytes.push(0);
        for (const [off, b] of area.code.entries()) {
          const abs = base + off;
          while (imageBytes.length <= abs) imageBytes.push(0);
          imageBytes[abs] = b & 0xff;
        }
      }
      cursor += area.size;
    }
  }

  const globalDefs: Map<string, number> = new Map();
  for (let mi = 0; mi < ordered.length; mi += 1) {
    const mod = ordered[mi]!;
    for (const [name, def] of mod.defs.entries()) {
      if (globalDefs.has(name)) {
        throw new Error(`Duplicate global definition: ${name}`);
      }
      const areaName = canonicalAreaName(def.area);
      const base = modAreaBase.get(`${mi}\0${areaName}`) ?? 0;
      globalDefs.set(name, base + def.offset);
    }
  }

  for (const mod of ordered) {
    for (const name of mod.refs) {
      if (!globalDefs.has(name)) {
        throw new Error(`Unresolved external symbol: ${name}`);
      }
    }
  }

  for (let mi = 0; mi < ordered.length; mi += 1) {
    const mod = ordered[mi]!;
    for (const r of mod.relocs) {
      const areaName = canonicalAreaName(r.area ?? "_CODE");
      const base = modAreaBase.get(`${mi}\0${areaName}`) ?? 0;
      const areaWordBase = Math.trunc(base / 2);
      const left = resolveOperand(r.left, globalDefs, areaWordBase);
      const right = resolveOperand(r.right, globalDefs, areaWordBase);
      const wordDiff = (left - right) & 0xffff;
      const absAddr = base + r.byteAddr;
      while (imageBytes.length < absAddr + 2) imageBytes.push(0);
      imageBytes[absAddr] = (wordDiff >> 8) & 0xff;
      imageBytes[absAddr + 1] = wordDiff & 0xff;
    }
  }

  return {
    image: Uint8Array.from(imageBytes),
    defs: globalDefs,
  };
}
