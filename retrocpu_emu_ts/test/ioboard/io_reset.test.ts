/**
 * IO ボードリセット（ブートモニタ DMA → CPU RST）
 * 根拠: ioboard.mdc「リセット時動作」
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { wordsToIntelHex } from "../../src/code_test/intel_hex";
import {
  expandBootMonitorHex,
  performIoBoardReset,
  readBootMonitorDmaSlice,
  resolveBootMonitorHexPath,
  type IoResetLink,
} from "../../src/ioboard/io_reset";
import {
  resetIoBoardCommandState,
  createIoBoardCommandState,
} from "../../src/ioboard/handshake/io_board_mock";
import { MODE } from "../../src/shared/handshake/handshake_type";

/**
 * 呼び出し順を記録するリセットリンクのモックを作る。
 * @returns リンクと記録配列
 */
function mockLink(): IoResetLink & {
  calls: string[];
  written: { byteAddr: number; data: Uint8Array }[];
} {
  const calls: string[] = [];
  const written: { byteAddr: number; data: Uint8Array }[] = [];
  return {
    calls,
    written,
    async setHalt(halt) {
      calls.push(`halt:${halt}`);
    },
    async writeBytes(byteAddr, data) {
      calls.push("dma");
      written.push({ byteAddr, data: new Uint8Array(data) });
    },
    async pulseReset(resetVectorWord) {
      calls.push(
        typeof resetVectorWord === "number"
          ? `rst:${resetVectorWord & 0xffff}`
          : "rst",
      );
    },
  };
}

describe("expandBootMonitorHex", () => {
  it("ワード 0x0200 の HEX をバイト 0x0400 からのスライスにする", () => {
    const hex = wordsToIntelHex(0x0200, [0x2000, 0xcffd]);
    const slice = expandBootMonitorHex(hex);
    expect(slice).not.toBeNull();
    expect(slice!.byteAddr).toBe(0x0400);
    expect(Array.from(slice!.data)).toEqual([0x20, 0x00, 0xcf, 0xfd]);
    expect(slice!.bytesWritten).toBe(4);
  });
});

describe("resolveBootMonitorHexPath / readBootMonitorDmaSlice", () => {
  it("明示パスが無ければ例外", () => {
    const missing = path.join(os.tmpdir(), "retrocpu-no-such-monitor.ihx");
    expect(() => resolveBootMonitorHexPath(missing)).toThrow(
      /ブートモニタ IHX/,
    );
  });

  it("明示パスの IHX を読める", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retrocpu-mon-"));
    const hexPath = path.join(dir, "boot_monitor.ihx");
    fs.writeFileSync(hexPath, wordsToIntelHex(0x0200, [0x2000]));
    expect(resolveBootMonitorHexPath(hexPath)).toBe(path.resolve(hexPath));
    const slice = readBootMonitorDmaSlice(hexPath);
    expect(slice.byteAddr).toBe(0x0400);
    expect(slice.bytesWritten).toBe(2);
  });
});

describe("performIoBoardReset", () => {
  it("HALT → DMA → RST の順でブートモニタを載せる", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retrocpu-mon-"));
    const hexPath = path.join(dir, "boot_monitor.ihx");
    fs.writeFileSync(hexPath, wordsToIntelHex(0x0100, [0xe000, 0x0200]));
    const link = mockLink();
    const result = await performIoBoardReset(link, hexPath, 0x0108);
    expect(link.calls).toEqual(["halt:true", "dma", "rst:264"]);
    expect(result.bytesWritten).toBe(4);
    expect(result.hexPath).toBe(hexPath);
    expect(link.written[0]!.byteAddr).toBe(0x0200);
    expect(Array.from(link.written[0]!.data)).toEqual([0xe0, 0x00, 0x02, 0x00]);
  });
});

describe("resetIoBoardCommandState", () => {
  it("モードとキー状態を初期値に戻す", () => {
    const state = createIoBoardCommandState();
    state.mode = MODE.FREE;
    state.hexKeys[0] = 0xff;
    state.lastBeep = { frequencyHz: 440, durationMs: 10 };
    resetIoBoardCommandState(state);
    expect(state.mode).toBe(MODE.MONITOR);
    expect(state.hexKeys[0]).toBe(0);
    expect(state.lastBeep).toBeNull();
  });
});

describe("実機 mn1613_mon.ihx（あれば）", () => {
  it("モニター入口 0x0108 を含む", () => {
    let hexPath: string;
    try {
      hexPath = resolveBootMonitorHexPath();
    } catch {
      return;
    }
    const slice = readBootMonitorDmaSlice(hexPath);
    expect(slice.bytesWritten).toBeGreaterThan(0);
    const entryByte = 0x0108 * 2;
    expect(slice.byteAddr).toBeLessThanOrEqual(entryByte);
    expect(slice.byteAddr + slice.data.length).toBeGreaterThan(entryByte);
  });
});
