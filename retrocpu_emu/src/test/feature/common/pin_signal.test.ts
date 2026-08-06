import { describe, it, expect } from "vitest";
import {
  commitSample,
  createInputPin,
  risingEdge,
  setInputLevel,
  takeDeferred,
  deferIfAsserted,
} from "../../../main/feature/common/pin_signal";
import {
  setPins,
  getPins,
  getPendingIrq,
  reset,
  getState,
  startRun,
  tickCpu,
  getExecStatus,
  setMemory,
  setIoReadCallback,
  halt,
} from "../../../main/feature/cpu/mn1613/mn1613";

describe("pin_signal", () => {
  it("risingEdge を [0]/[1] で検出する", () => {
    const p = createInputPin(false);
    setInputLevel(p, true);
    expect(risingEdge(p)).toBe(true);
    commitSample(p);
    expect(risingEdge(p)).toBe(false);
  });

  it("defer / takeDeferred", () => {
    const p = createInputPin(true);
    deferIfAsserted(p);
    expect(takeDeferred(p)).toBe(true);
    expect(takeDeferred(p)).toBe(false);
  });
});

describe("mn1613 pin + tickCpu", () => {
  it("RST パルスでレジスタがクリアされる", () => {
    setIoReadCallback((_p) => 0);
    reset();
    const buf = new ArrayBuffer(0x10000);
    new DataView(buf).setUint16(0, 0x0801, false); // MVI R0,#1
    setMemory(buf);
    startRun();
    tickCpu();
    expect(getState().R[0]).toBe(1);
    setPins({ RST: true });
    setPins({ RST: false });
    expect(getState().R[0]).toBe(0);
    expect(getState().IC).toBe(0);
    expect(getExecStatus()).toBe("running");
  });

  it("tickCpu は halted では命令を進めない", () => {
    setIoReadCallback((_p) => 0);
    reset();
    halt();
    const ic = getState().IC;
    tickCpu();
    expect(getState().IC).toBe(ic);
    expect(getExecStatus()).toBe("halted");
  });

  it("IRQ ピン下げても pending は残る", () => {
    reset();
    setPins({ IRQ2: true });
    expect(getPendingIrq() & 4).toBe(4);
    setPins({ IRQ2: false });
    expect(getPins().IRQ2).toBe(false);
    expect(getPendingIrq() & 4).toBe(4);
  });
});
