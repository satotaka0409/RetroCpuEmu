import type { AsmCpuType } from "../types.js";

/**
 * MAIN が無いときの `_CODE` 原点（ワード）。MN1613 は割り込み領域を避ける。
 * @param cpu CPU
 * @param hasMain ソースに MAIN があるか
 * @returns スタブを置くワード。0 ならスタブ無し
 */
export function mn1613DefaultCodeOrgWord(
  cpu: AsmCpuType,
  hasMain: boolean,
): number {
  if (hasMain) {
    return 0;
  }
  if (cpu === "mn1613") {
    return 0x0200;
  }
  return 0;
}

/**
 * `_CODE` を指定ワードから始める MAIN スタブ。割り込み退避領域（0–7）と重ならないようにする。
 * @param orgWord `_CODE` 原点（ワード）
 * @param cpu 先頭 `.cpu` に書く CPU（既定 mn1613）
 * @returns スタブソース
 */
export function mn1613MainStub(
  orgWord: number,
  cpu: AsmCpuType = "mn1613",
): string {
  return [
    `\t.cpu\t${cpu}`,
    "\t.area\t_CODE\t\t(REL,CON)",
    `\t.org\t0x${orgWord.toString(16).toUpperCase()}`,
    "\t.global\t__TEST_FRAME_MAIN",
    "__TEST_FRAME_MAIN:",
    "\th",
    "",
  ].join("\n");
}
