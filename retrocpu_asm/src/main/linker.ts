import type { RelocOperand } from "./types";
import { parseRel, type RelModule } from "./relParser";

/** リンク結果 */
export interface LinkResult {
  /** 結合後のメモリイメージ（バイト） */
  image: Uint8Array;
  /** 解決済みグローバル定義（バイトアドレス） */
  defs: Map<string, number>;
}

/**
 * リロケーションオペランドを絶対ワードアドレスに解決する。
 * @param op - オペランド
 * @param defs - グローバル Def（バイト）
 * @param moduleWordBase - このモジュールの絶対ワード基準
 * @return ワードアドレス
 */
function resolveOperand(
  op: RelocOperand,
  defs: Map<string, number>,
  moduleWordBase: number,
): number {
  if (op.kind === "word") {
    return (moduleWordBase + op.value) & 0xffff;
  }
  const byteAddr: number | undefined = defs.get(op.name);
  if (byteAddr === undefined) {
    throw new Error(`Unresolved symbol in W record: ${op.name}`);
  }
  return Math.trunc(byteAddr / 2) & 0xffff;
}

/**
 * 複数の REL テキストをリンクする。
 * `_CODE` を連結し、W レコードをワード差でパッチする。
 * @param relTexts - .rel ファイル内容の配列（リンク順）
 * @return リンク結果
 */
export function linkRelTexts(relTexts: string[]): LinkResult {
  const modules: RelModule[] = relTexts.map(parseRel);
  return linkModules(modules);
}

/**
 * パース済みモジュールをリンクする。
 * @param modules - モジュール配列
 * @return リンク結果
 */
export function linkModules(modules: RelModule[]): LinkResult {
  if (modules.length === 0) {
    return { image: new Uint8Array(0), defs: new Map() };
  }

  const globalDefs: Map<string, number> = new Map();
  const imageBytes: number[] = [];
  let codeBase = 0;

  // 第1パス: コード連結と Def 配置
  for (const mod of modules) {
    for (const [name, byteAddr] of mod.defs.entries()) {
      if (globalDefs.has(name)) {
        throw new Error(`Duplicate global definition: ${name}`);
      }
      globalDefs.set(name, codeBase + byteAddr);
    }

    const size: number = Math.max(
      mod.codeSize,
      ...[...mod.code.keys()].map((a) => a + 1),
      0,
    );
    while (imageBytes.length < codeBase + size) {
      imageBytes.push(0);
    }
    for (const [addr, b] of mod.code.entries()) {
      imageBytes[codeBase + addr] = b & 0xff;
    }
    codeBase += size;
  }

  // Ref 解決チェック
  for (const mod of modules) {
    for (const name of mod.refs) {
      if (!globalDefs.has(name)) {
        throw new Error(`Unresolved external symbol: ${name}`);
      }
    }
  }

  // 第2パス: W レコードをワード差でパッチ
  codeBase = 0;
  for (const mod of modules) {
    const size: number = Math.max(
      mod.codeSize,
      ...[...mod.code.keys()].map((a) => a + 1),
      0,
    );
    const moduleWordBase: number = Math.trunc(codeBase / 2);
    for (const r of mod.relocs) {
      const left: number = resolveOperand(r.left, globalDefs, moduleWordBase);
      const right: number = resolveOperand(
        r.right,
        globalDefs,
        moduleWordBase,
      );
      const wordDiff: number = (left - right) & 0xffff;
      const absAddr: number = codeBase + r.byteAddr;
      if (absAddr + 1 >= imageBytes.length) {
        while (imageBytes.length < absAddr + 2) imageBytes.push(0);
      }
      imageBytes[absAddr] = (wordDiff >> 8) & 0xff;
      imageBytes[absAddr + 1] = wordDiff & 0xff;
    }
    codeBase += size;
  }

  return {
    image: Uint8Array.from(imageBytes),
    defs: globalDefs,
  };
}
