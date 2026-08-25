/**
 * Intel HEX → DMA チャンク
 * 根拠: ioboard.mdc（HEX は DMA。未記録番地は触らない）
 */

import { describe, it, expect } from "vitest";
import {
  intelHexToDmaPlan,
  wordsToIntelHex,
} from "../../src/code_test/intel_hex";
import { dmaLoadIntelHex } from "../../src/ioboard/intel_hex_dma";

describe("intelHexToDmaPlan", () => {
  it("連続ワードは 1 チャンクにする", () => {
    const hex = wordsToIntelHex(0x1800, [0x2000, 0x4801]);
    const plan = intelHexToDmaPlan(hex);
    expect(plan.bytesWritten).toBe(4);
    expect(plan.minAddr).toBe(0x3000);
    expect(plan.maxAddr).toBe(0x3003);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]!.byteAddr).toBe(0x3000);
    expect(Array.from(plan.chunks[0]!.data)).toEqual([0x20, 0x00, 0x48, 0x01]);
  });

  it("離れたレコードは別チャンクにし、穴を 0 埋めしない", () => {
    const a = wordsToIntelHex(0x0108, [0x2000]).replace(":00000001FF\n", "");
    const b = wordsToIntelHex(0x1800, [0x4801]);
    const plan = intelHexToDmaPlan(a + b);
    expect(plan.chunks).toHaveLength(2);
    expect(plan.chunks[0]!.byteAddr).toBe(0x0210);
    expect(Array.from(plan.chunks[0]!.data)).toEqual([0x20, 0x00]);
    expect(plan.chunks[1]!.byteAddr).toBe(0x3000);
    expect(Array.from(plan.chunks[1]!.data)).toEqual([0x48, 0x01]);
    expect(plan.bytesWritten).toBe(4);
  });
});

describe("dmaLoadIntelHex", () => {
  it("チャンクごとに writeBytes する", async () => {
    const a = wordsToIntelHex(0x0108, [0x2000]).replace(":00000001FF\n", "");
    const b = wordsToIntelHex(0x1800, [0x4801]);
    const written: { byteAddr: number; data: number[] }[] = [];
    const plan = await dmaLoadIntelHex(a + b, async (byteAddr, data) => {
      written.push({ byteAddr, data: Array.from(data) });
    });
    expect(plan.chunks).toHaveLength(2);
    expect(written).toEqual([
      { byteAddr: 0x0210, data: [0x20, 0x00] },
      { byteAddr: 0x3000, data: [0x48, 0x01] },
    ]);
  });
});
