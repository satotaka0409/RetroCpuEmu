/**
 * DMA 転送テスト（ioboard.mdc）
 * HALT/RUN は setPins / getPins().RUN に配線
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createDmaBus,
  DmaMaster,
  dmaMemoryFromArrayBuffer,
  isDmaBusy,
  liveDmaCpuBridge,
  type DmaCpuBridge,
} from "../../../main/feature/board/dma";
import {
  getPins,
  reset,
  setMemory,
  setPins,
  startRun,
  getMemory,
} from "../../../main/feature/cpu/mn1613/mn1613";

describe("DmaMaster", () => {
  let buf: ArrayBuffer;
  let master: DmaMaster;

  beforeEach(() => {
    setPins({ HLT: false, RST: false });
    reset();
    buf = new ArrayBuffer(0x10000);
    setMemory(buf);
    const bus = createDmaBus();
    // 実CPU配線（idle なら RUN=false）
    master = new DmaMaster(
      bus,
      dmaMemoryFromArrayBuffer(getMemory()),
      500,
      liveDmaCpuBridge,
    );
  });

  it("writeBytes / readBytes で往復できる", async () => {
    const data = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);
    await master.writeBytes(0x200, data);
    expect(isDmaBusy()).toBe(false);
    expect(getPins().HLT).toBe(false);
    const read = await master.readBytes(0x200, 4);
    expect(read).toEqual(data);
  });

  it("奇数長でも末尾を書ける", async () => {
    await master.writeBytes(0x100, new Uint8Array([0xaa, 0xbb, 0xcc]));
    const read = await master.readBytes(0x100, 3);
    expect(read[0]).toBe(0xaa);
    expect(read[1]).toBe(0xbb);
    expect(read[2]).toBe(0xcc);
  });

  it("実行中でも HALT で RUN が落ちてから転送する", async () => {
    // 自己ループを置いて RUN
    const view = new DataView(getMemory());
    view.setUint16(0, 0xc700, false); // B $+0
    startRun();
    expect(getPins().RUN).toBe(true);

    const data = new Uint8Array([0x11, 0x22]);
    await master.writeBytes(0x80, data);
    expect(getPins().RUN).toBe(false);
    expect(getPins().HLT).toBe(false); // セッション終了で release
    const read = await master.readBytes(0x80, 2);
    expect(read).toEqual(data);
  });

  it("isRunning が true のままならタイムアウトする", async () => {
    const stuck: DmaCpuBridge = {
      assertHalt: () => {},
      releaseHalt: () => {},
      isRunning: () => true,
    };
    const bus = createDmaBus();
    const m = new DmaMaster(
      bus,
      dmaMemoryFromArrayBuffer(buf),
      50,
      stuck,
    );
    await expect(m.writeBytes(0, new Uint8Array([1, 2]))).rejects.toThrow(
      /timeout/,
    );
    expect(isDmaBusy()).toBe(false);
  });
});
