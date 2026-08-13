/**
 * コールドブート（HALT スタブ）試験
 * 根拠: MN1613.mdc リセット / cpuboard/boot.ts
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  coldBootHaltStub,
  enterResetWait,
  loadHaltStubAtMonitorEntry,
  pulseCpuReset,
} from "../../src/cpuboard/boot";
import {
  getExecStatus,
  getMemory,
  getPins,
  getState,
  reset,
  setIoReadCallback,
  setIoWriteCallback,
  setPins,
  tickCpu,
} from "../../src/cpuboard/mn1613/mn1613";
import {
  MONITOR_ENTRY_WORD,
  OPCODE_H,
  attachIoBoardPorts,
  setResetVector,
} from "../../src/cpuboard/io_ports";

beforeEach(() => {
  setPins({
    HLT: false,
    RST: false,
    IRQ0: false,
    IRQ1: false,
    IRQ2: false,
    BSAV: false,
    STRT: false,
  });
  setIoReadCallback((_p) => 0);
  setIoWriteCallback((_p, _v) => {});
});

describe("MN1613 reset vector (IO:0)", () => {
  it("reset() は IO:0 を IC に載せ running になる", () => {
    setIoReadCallback((p) => (p === 0 ? MONITOR_ENTRY_WORD : 0));
    reset();
    expect(getState().IC).toBe(MONITOR_ENTRY_WORD);
    expect(getExecStatus()).toBe("running");
  });
});

describe("coldBootHaltStub", () => {
  it("リセット待ち → スタブ展開 → RST → tick で halted", () => {
    const wait = enterResetWait();
    expect(wait.phase).toBe("reset_wait");
    expect(wait.status).toBe("idle");

    const stub = loadHaltStubAtMonitorEntry();
    expect(stub.phase).toBe("vector_ready");
    const view = new DataView(getMemory());
    expect(view.getUint16(MONITOR_ENTRY_WORD * 2, false)).toBe(OPCODE_H);

    const pulsed = pulseCpuReset();
    expect(pulsed.ic).toBe(MONITOR_ENTRY_WORD);
    expect(pulsed.status).toBe("running");

    tickCpu();
    expect(getExecStatus()).toBe("halted");
    expect(getState().IC).toBe((MONITOR_ENTRY_WORD + 1) & 0xffff);
  });

  it("coldBootHaltStub 一式でも RST 直後は running、1命令で halted", () => {
    const r = coldBootHaltStub();
    expect(r.status).toBe("running");
    expect(r.ic).toBe(MONITOR_ENTRY_WORD);
    tickCpu();
    expect(getExecStatus()).toBe("halted");
  });

  it("pulseCpuReset は HLT を落としてから RST するので running になる", () => {
    attachIoBoardPorts();
    setResetVector(MONITOR_ENTRY_WORD);
    const view = new DataView(getMemory());
    view.setUint16(MONITOR_ENTRY_WORD * 2, OPCODE_H, false);
    setPins({ HLT: true });
    expect(getPins().HLT).toBe(true);
    const pulsed = pulseCpuReset();
    expect(getPins().HLT).toBe(false);
    expect(pulsed.ic).toBe(MONITOR_ENTRY_WORD);
    expect(pulsed.status).toBe("running");
  });

  it("setResetVector + attach 後の RST でベクタが効く", () => {
    attachIoBoardPorts();
    setResetVector(MONITOR_ENTRY_WORD);
    const view = new DataView(getMemory());
    view.setUint16(MONITOR_ENTRY_WORD * 2, OPCODE_H, false);
    setPins({ RST: true });
    setPins({ RST: false });
    expect(getState().IC).toBe(MONITOR_ENTRY_WORD);
    tickCpu();
    expect(getExecStatus()).toBe("halted");
  });
});
