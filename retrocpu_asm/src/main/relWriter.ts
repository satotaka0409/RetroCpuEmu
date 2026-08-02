import type { AssemblyResult, RelocOperand } from "./types";

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
  return `#${hex4(op.value)}`;
}

/**
 * アセンブル結果をREL形式テキストに変換する。
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

  const globalEntries: Array<{ name: string; def: boolean; value: number }> =
    [];
  for (const [name, info] of result.symbolInfos.entries()) {
    if (info.kind === "global") {
      globalEntries.push({ name, def: true, value: info.value });
    } else if (info.kind === "external") {
      globalEntries.push({ name, def: false, value: 0 });
    }
  }
  globalEntries.sort((a, b) => a.name.localeCompare(b.name));

  lines.push(
    `H ${hex4(1)} areas ${hex4(globalEntries.length)} global symbols`,
  );
  lines.push(`M ${moduleName}`);

  const maxAddr: number =
    result.words.length === 0
      ? -1
      : result.words.reduce((m, w) => Math.max(m, w.address), 0);
  const codeSizeBytes: number =
    maxAddr < 0 ? 0 : byteAddrs ? maxAddr + 2 : (maxAddr + 1) * 2;
  lines.push(`A _CODE size ${hex4(codeSizeBytes)} flags 0000`);

  const sorted: AssemblyResult["words"] = [...result.words].sort(
    (a, b) => a.address - b.address,
  );
  let idx: number = 0;
  while (idx < sorted.length) {
    const runStart: number = idx;
    let runEnd: number = idx;
    while (
      runEnd + 1 < sorted.length &&
      sorted[runEnd + 1].address === sorted[runEnd].address + addrStep
    ) {
      runEnd += 1;
    }

    let p: number = runStart;
    while (p <= runEnd) {
      const chunkWords: number = Math.min(8, runEnd - p + 1);
      const firstAddr: number = sorted[p].address;
      const byteAddr: number = byteAddrs ? firstAddr : firstAddr * 2;
      const bytes: number[] = [];
      for (let i: number = 0; i < chunkWords; i += 1) {
        const w: number = sorted[p + i].value & 0xffff;
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
    if (g.def) {
      const defBytes = byteAddrs ? g.value : g.value * 2;
      lines.push(`S ${g.name} Def${hex4(defBytes)}`);
    } else {
      lines.push(`S ${g.name} Ref0000`);
    }
  }

  const sortedRelocs = [...result.relocs].sort((a, b) => {
    if (a.byteAddr !== b.byteAddr) return a.byteAddr - b.byteAddr;
    return (
      formatRelocOperand(a.left).localeCompare(formatRelocOperand(b.left)) ||
      formatRelocOperand(a.right).localeCompare(formatRelocOperand(b.right))
    );
  });
  for (const r of sortedRelocs) {
    lines.push(
      `W ${hex4(r.byteAddr)} ${formatRelocOperand(r.left)}-${formatRelocOperand(r.right)}`,
    );
  }

  lines.push("E");
  return lines.join("\n") + "\n";
}
