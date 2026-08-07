/**
 * DMA 転送テスト（ioboard.mdc）
 * 書き込み専用。検証は CPU 側 getMemory() で行う（IO からの読み込みは禁止）。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createDmaBus,
  DmaMaster,
  dmaWriteMemoryFromArrayBuffer,
  isDmaBusy,
  liveDmaCpuBridge,
  type DmaCpuBridge,
} from "../../../main/feature/board/dma";
import { CpuDmaTarget, isCpuDmaBusy } from "../../../main/feature/board/cpu_dma";
import {
  getPins,
  reset,
  setMemory,
  setPins,
  startRun,
  getMemory,
  getExecStatus,
  powerOnIdle,
} from "../../../main/feature/cpu/mn1613/mn1613";

/**
 * CPU メモリからバイト列を読む（範囲外に達したら以降は 0）。
 * @param byteAddr 開始バイトアドレス
 * @param length 読み出すバイト数
 * @returns 読み出したバイト列
 */
function readBytes(byteAddr: number, length: number): Uint8Array {
  const view = new DataView(getMemory());
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    const off = (byteAddr + i) >>> 0;
    if (off >= view.byteLength) break;
    out[i] = view.getUint8(off);
  }
  return out;
}

describe("DmaMaster (write-only)", () => {
  let buf: ArrayBuffer;
  let master: DmaMaster;

  beforeEach(() => {
    setPins({ HLT: false, RST: false });
    reset();
    buf = new ArrayBuffer(0x10000);
    setMemory(buf);
    const bus = createDmaBus();
    master = new DmaMaster(
      bus,
      dmaWriteMemoryFromArrayBuffer(getMemory()),
      500,
      liveDmaCpuBridge,
    );
  });

  it("writeBytes で RAM に書ける（読みは CPU 側で確認）", async () => {
    const data = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);
    await master.writeBytes(0x200, data);
    expect(isDmaBusy()).toBe(false);
    expect(getPins().HLT).toBe(false);
    expect(readBytes(0x200, 4)).toEqual(data);
  });

  it("奇数長でも末尾を書ける", async () => {
    await master.writeBytes(0x100, new Uint8Array([0xaa, 0xbb, 0xcc]));
    const read = readBytes(0x100, 3);
    expect(read[0]).toBe(0xaa);
    expect(read[1]).toBe(0xbb);
    expect(read[2]).toBe(0xcc);
  });

  it("実行中でも HALT で RUN が落ちてから転送する", async () => {
    const view = new DataView(getMemory());
    view.setUint16(0, 0xc700, false); // B $+0
    startRun();
    expect(getPins().RUN).toBe(true);

    const data = new Uint8Array([0x11, 0x22]);
    await master.writeBytes(0x80, data);
    expect(getPins().RUN).toBe(false);
    expect(getPins().HLT).toBe(false);
    expect(readBytes(0x80, 2)).toEqual(data);
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
      dmaWriteMemoryFromArrayBuffer(buf),
      50,
      stuck,
    );
    await expect(m.writeBytes(0, new Uint8Array([1, 2]))).rejects.toThrow(
      /timeout/,
    );
    expect(isDmaBusy()).toBe(false);
  });
});

describe("CpuDmaTarget (write-only, HALT/RESET)", () => {
  beforeEach(() => {
    setMemory(new ArrayBuffer(0x10000));
    setPins({
      HLT: false,
      RST: false,
      IRQ0: false,
      IRQ1: false,
      IRQ2: false,
      BSAV: false,
      STRT: false,
    });
    powerOnIdle();
  });

  it("idle(RESET 待ち) では書き込める", async () => {
    expect(getExecStatus()).toBe("idle");
    const dma = new CpuDmaTarget(200);
    await dma.writeBytes(0x10, new Uint8Array([0xde, 0xad]));
    expect(isCpuDmaBusy()).toBe(false);
    expect(readBytes(0x10, 2)).toEqual(new Uint8Array([0xde, 0xad]));
  });

  it("HLT アサート中は書き込める", async () => {
    setPins({ HLT: true });
    const dma = new CpuDmaTarget(200);
    await dma.writeWords(0x20, [0x1234]);
    expect(readBytes(0x40, 2)).toEqual(new Uint8Array([0x12, 0x34]));
    expect(getPins().HLT).toBe(false); // セッション終了で解放
  });

  it("running 中は HALT してから書く", async () => {
    reset();
    const view = new DataView(getMemory());
    view.setUint16(0, 0xc700, false);
    startRun();
    expect(getPins().RUN).toBe(true);
    const dma = new CpuDmaTarget(500);
    await dma.writeBytes(0x80, new Uint8Array([0x11, 0x22]));
    expect(readBytes(0x80, 2)).toEqual(new Uint8Array([0x11, 0x22]));
    expect(getPins().HLT).toBe(false);
  });
});
