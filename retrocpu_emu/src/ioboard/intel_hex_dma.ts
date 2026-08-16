/**
 * Intel HEX を IO→CPU DMA で 2階 RAM へ書く。
 * 根拠: ioboard.mdc（HALT/RESET 時のみ。ハンドシェイク 14h ではない）
 */

import {
  intelHexToDmaPlan,
  type IntelHexDmaPlan,
} from "../code_test/intel_hex";

/** DMA 書き込み関数（BoardLinkClient.writeBytes と同じ） */
export type DmaWriteBytes = (
  byteAddr: number,
  data: Uint8Array,
) => Promise<void>;

/**
 * HEX を展開し、記録のある連続区間だけ DMA する。
 * @param hexText Intel HEX 全文
 * @param writeBytes DMA 書き込み
 * @returns チャンク集計。データが無ければ bytesWritten=0
 */
export async function dmaLoadIntelHex(
  hexText: string,
  writeBytes: DmaWriteBytes,
): Promise<IntelHexDmaPlan> {
  const plan = intelHexToDmaPlan(hexText);
  for (const chunk of plan.chunks) {
    if (chunk.data.length === 0) continue;
    await writeBytes(chunk.byteAddr, chunk.data);
  }
  return plan;
}
