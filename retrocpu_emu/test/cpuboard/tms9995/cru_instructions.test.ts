/**
 * TMS9995 LDCR/STCR / SBO/SBZ/TB と CRU 配線の結合試験。
 * 根拠: interrupt_io.inc / handshake_common.asm / HandShake.mdc
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { CpuIoSignals } from "../../../src/cpuboard/mn1613/mn1613ioport";
import {
  CPU_PORT_MODE,
  attachHandshakeBus,
  setCpuPortMode,
  tms9995CpuReadCruBit,
} from "../../../src/cpuboard/io_ports";
import {
  getDecrementerEnabled,
  getExecStatus,
  getState,
  peekByte,
  pokeByte,
  powerOnIdle,
  reset,
  setDecrementerEnabled,
  setMemory,
  setState,
  tickCpu,
} from "../../../src/cpuboard/tms9995/tms9995";
import { ST_EQ, TMS_MEM_BYTES } from "../../../src/cpuboard/tms9995/types";

/** 偶数バイトアドレスから 16bit BE で読む */
function peekWord(addr: number): number {
  return ((peekByte(addr) << 8) | peekByte(addr + 1)) & 0xffff;
}

/** 偶数バイトアドレスへ 16bit BE で書く */
function pokeWord(addr: number, value: number): void {
  pokeByte(addr, value >>> 8);
  pokeByte(addr + 1, value & 0xff);
}

function makeBus(): CpuIoSignals {
  return {
    INTERRUPT_BUSY: 0,
    INT_CAUSE: 0,
    HSHK_OUT_DENA: 0,
    HSHK_OUT_DACK: 0,
    HSHK_IN_DENA: 0,
    HSHK_IN_DACK: 0,
    HSHK_OUT_REQ: 0,
    HSHK_IN_REQ: 0,
    HSHK_IN_DATA: 0,
    HSHK_OUT_DATA: 0,
    CLK: 0,
  };
}

/** reset 用 WP/PC を書き、pc から命令列を配置する */
function bootProgram(wp: number, pc: number, insns: number[]): void {
  pokeWord(0, wp);
  pokeWord(2, pc);
  let addr = pc;
  for (const w of insns) {
    pokeWord(addr, w);
    addr += 2;
  }
}

/** 命令列を先頭から順に tickCpu する */
function runInsns(count: number): void {
  for (let i = 0; i < count; i += 1) tickCpu();
}

describe("TMS9995 CRU instructions", () => {
  let bus: CpuIoSignals;

  beforeEach(() => {
    setMemory(new ArrayBuffer(TMS_MEM_BYTES));
    powerOnIdle();
    setDecrementerEnabled(false);
    bus = makeBus();
    attachHandshakeBus(bus);
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
  });

  it("LI R3 baseline (core tickCpu)", () => {
    bootProgram(0x0100, 0x0200, [0x0203, 0xa500, 0x0340]);
    reset();
    expect(getExecStatus()).toBe("running");
    tickCpu();
    expect(getState().R[3]).toBe(0xa500);
  });

  it("LDCR R3,#8 at 0023h sends byte to HSHK_OUT_DATA latch", () => {
    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0023, // LI R12, #HSHK_OUT_DATA_BASE
      0x0203,
      0xa500, // LI R3, #0xA500（LDCR #8 はレジスタ上位バイト）
      0x3203, // LDCR R3, #8
      0x0340, // IDLE
    ]);
    reset();
    runInsns(4);

    expect(bus.HSHK_OUT_DATA).toBe(0xa5);
    expect(getState().R[3]).toBe(0xa500);
  });

  it("LDCR R3,#8 does not clear HSHK_OUT_REQ control line", () => {
    bus.HSHK_OUT_REQ = 1;
    attachHandshakeBus(bus);

    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0023,
      0x0203,
      0xff00,
      0x3203, // LDCR R3, #8
      0x0340,
    ]);
    reset();
    runInsns(4);

    expect(bus.HSHK_OUT_REQ).toBe(1);
    expect(bus.HSHK_OUT_DATA).toBe(0xff);
  });

  it("LDCR R3,#1 at 0020h sets HSHK_OUT_REQ from register MSB bit0", () => {
    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0020, // LI R12, #HSHK_OUT_REQ
      0x0203,
      0x0100, // LI R3, #0x0100（MSB bit0=1）
      0x3043, // LDCR R3, #1
      0x0340,
    ]);
    reset();
    runInsns(4);

    expect(bus.HSHK_OUT_REQ).toBe(1);
    expect(tms9995CpuReadCruBit(0x0020)).toBe(1);
  });

  it("STCR R3,#8 at 0027h receives HSHK_IN_DATA latch", () => {
    bus.HSHK_IN_DATA = 0x3c;
    attachHandshakeBus(bus);

    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0027, // LI R12, #HSHK_IN_DATA_BASE
      0x3603, // STCR R3, #8
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(getState().R[3]).toBe(0x3c00);
  });

  it("STCR R3,#2 at 0024h reads per-bit HSHK_IN_REQ and HSHK_IN_DENA", () => {
    bus.HSHK_IN_REQ = 1;
    bus.HSHK_IN_DENA = 1;
    attachHandshakeBus(bus);

    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0024, // LI R12, #HSHK_IN_REQ
      0x3483, // STCR R3, #2
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(getState().R[3]).toBe(0x0300);
  });

  it("LDCR then STCR round-trip on HSHK data byte latch", () => {
    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0023,
      0x0203,
      0x5a00, // LI R3, #0x5A00
      0x3203, // LDCR R3, #8 → OUT_DATA
      0x020c,
      0x0027,
      0x3603, // STCR R3, #8 ← IN_DATA（IO が OUT を IN にエコーしないので bus を直接設定）
      0x0340,
    ]);
    bus.HSHK_IN_DATA = 0x5a;
    attachHandshakeBus(bus);

    reset();
    runInsns(6);

    expect(bus.HSHK_OUT_DATA).toBe(0x5a);
    expect(getState().R[3]).toBe(0x5a00);
  });

  it("SBO #1 on R12=1EE0h enables decrementer (FLAG1)", () => {
    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x1ee0, // LI R12, #TMS_FLAG_CRU
      0x1d01, // SBO #1 → 1EE1h
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(getDecrementerEnabled()).toBe(true);
    expect(tms9995CpuReadCruBit(0x1ee1)).toBe(1);
  });

  it("SBZ #1 on R12=1EE0h disables decrementer (FLAG1)", () => {
    setDecrementerEnabled(true);

    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x1ee0,
      0x1e01, // SBZ #1 → 1EE1h
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(getDecrementerEnabled()).toBe(false);
    expect(tms9995CpuReadCruBit(0x1ee1)).toBe(0);
  });

  it("SBO #0 on R12=0020h sets HSHK_OUT_REQ", () => {
    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0020,
      0x1d00, // SBO #0
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(bus.HSHK_OUT_REQ).toBe(1);
  });

  it("SBZ #0 on R12=0020h clears HSHK_OUT_REQ", () => {
    bus.HSHK_OUT_REQ = 1;
    attachHandshakeBus(bus);

    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0020,
      0x1e00, // SBZ #0
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(bus.HSHK_OUT_REQ).toBe(0);
  });

  it("TB #0 sets ST_EQ when HSHK_IN_REQ is 1", () => {
    bus.HSHK_IN_REQ = 1;
    attachHandshakeBus(bus);

    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0024, // LI R12, #HSHK_IN_REQ
      0x1f00, // TB #0
      0x0340,
    ]);
    reset();
    runInsns(3);

    expect(getState().STR & ST_EQ).toBe(ST_EQ);
  });

  it("TB #0 clears ST_EQ when HSHK_IN_REQ is 0", () => {
    bootProgram(0x0100, 0x0200, [
      0x020c,
      0x0024,
      0x1f00, // TB #0
      0x0340,
    ]);
    reset();
    setState({ STR: ST_EQ });
    runInsns(3);

    expect(getState().STR & ST_EQ).toBe(0);
  });
});
