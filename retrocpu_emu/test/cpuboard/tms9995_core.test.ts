/**
 * TMS9995 命令コアの単体試験。
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  getDecrementerEnabled,
  getExecStatus,
  getState,
  peekByte,
  pokeByte,
  powerOnIdle,
  reset,
  setMemory,
  tickCpu,
} from "../../src/cpuboard/tms9995/tms9995";
import { CPU_PORT_MODE, setCpuPortMode } from "../../src/cpuboard/io_ports";
import { ST_C, ST_OV, TMS_MEM_BYTES } from "../../src/cpuboard/tms9995/types";

/** 偶数バイトアドレスから 16bit BE で読む */
function peekWord(addr: number): number {
  return ((peekByte(addr) << 8) | peekByte(addr + 1)) & 0xffff;
}

/** 偶数バイトアドレスへ 16bit BE で書く */
function pokeWord(addr: number, value: number): void {
  pokeByte(addr, value >>> 8);
  pokeByte(addr + 1, value & 0xff);
}

/** reset 用 WP/PC と先頭命令 1 語をセットする */
function bootAt(pc: number, wp: number, insn: number): void {
  pokeWord(0, wp);
  pokeWord(2, pc);
  pokeWord(pc, insn);
}

describe("TMS9995 core", () => {
  beforeEach(() => {
    setMemory(new ArrayBuffer(TMS_MEM_BYTES));
    powerOnIdle();
  });

  it("reset loads WP/PC from mem[0]/mem[2]", () => {
    pokeByte(0x00, 0xff);
    pokeByte(0x01, 0x00);
    pokeByte(0x02, 0x01);
    pokeByte(0x03, 0x10);
    reset();
    const st = getState();
    expect(st.IC).toBe(0x0110);
    expect(getExecStatus()).toBe("running");
  });

  it("LI writes workspace R0", () => {
    pokeByte(0x00, 0xff);
    pokeByte(0x01, 0x00);
    pokeByte(0x02, 0x00);
    pokeByte(0x03, 0x10);
    pokeByte(0x10, 0x02);
    pokeByte(0x11, 0x00);
    pokeByte(0x12, 0x00);
    pokeByte(0x13, 0x01);
    reset();
    tickCpu();
    expect(getExecStatus()).toBe("running");
    expect(getState().R[0]).toBe(1);
  });

  it("LIMI sets interrupt mask", () => {
    pokeByte(0x00, 0xff);
    pokeByte(0x01, 0x00);
    pokeByte(0x02, 0x00);
    pokeByte(0x03, 0x10);
    pokeByte(0x10, 0x03);
    pokeByte(0x11, 0x00);
    pokeByte(0x12, 0x00);
    pokeByte(0x13, 0x03);
    reset();
    tickCpu();
    expect(getExecStatus()).toBe("running");
    expect(getState().STR & 0x000f).toBe(3);
  });

  it("IDLE halts", () => {
    pokeByte(0x00, 0xff);
    pokeByte(0x01, 0x00);
    pokeByte(0x02, 0x00);
    pokeByte(0x03, 0x10);
    pokeByte(0x10, 0x03);
    pokeByte(0x11, 0x40);
    reset();
    tickCpu();
    expect(getExecStatus()).toBe("halted");
  });

  it("B R11 (0x044B) branches to address in R11", () => {
    const wp = 0x0100;
    bootAt(0x0200, wp, 0x044b);
    pokeWord(wp + 11 * 2, 0x0300);
    pokeWord(0x0300, 0x0340);
    reset();
    tickCpu();
    tickCpu();
    expect(getExecStatus()).toBe("halted");
    expect(getState().IC).toBe(0x0302);
  });

  it("BL R11 (0x068B) saves return PC in R11", () => {
    const wp = 0x0100;
    bootAt(0x0200, wp, 0x068b);
    pokeWord(wp + 11 * 2, 0x0300);
    pokeWord(0x0300, 0x0340);
    reset();
    tickCpu();
    expect(peekWord(0x0116)).toBe(0x0202);
    tickCpu();
    expect(getExecStatus()).toBe("halted");
  });

  it("BLWP R5 (0x0405) loads WP/PC from vector", () => {
    const wp = 0x0100;
    bootAt(0x0200, wp, 0x0405);
    pokeWord(wp + 5 * 2, 0x0300);
    pokeWord(0x0300, 0x0400);
    pokeWord(0x0302, 0x0500);
    reset();
    tickCpu();
    expect(getState().IC).toBe(0x0500);
    expect(peekWord(0x041a)).toBe(0x0100);
    expect(peekWord(0x041c)).toBe(0x0202);
  });

  it("0x040B is BLWP R11 not B R11", () => {
    const wp = 0x0100;
    bootAt(0x0200, wp, 0x040b);
    pokeWord(wp + 11 * 2, 0x0300);
    pokeWord(0x0300, 0x0600);
    pokeWord(0x0302, 0x0700);
    reset();
    tickCpu();
    expect(getState().IC).toBe(0x0700);
  });

  it("SLA sets carry and overflow per MAME", () => {
    const wp = 0x0100;
    pokeWord(0, wp);
    pokeWord(2, 0x0200);
    pokeWord(0x0200, 0x0201);
    pokeWord(0x0202, 0x6000);
    pokeWord(0x0204, 0x0a11);
    reset();
    tickCpu();
    tickCpu();
    tickCpu();
    expect(getState().R[1]).toBe(0xc000);
    expect(getState().STR & ST_OV).toBe(ST_OV);
    expect(getState().STR & ST_C).toBe(0);
  });

  it("DIV sets OV and skips write on quotient overflow", () => {
    const wp = 0x0100;
    pokeWord(0, wp);
    pokeWord(2, 0x0200);
    pokeWord(0x0200, 0x3c05);
    pokeWord(wp + 5 * 2, 0x0001);
    pokeWord(wp, 0x0001);
    pokeWord(wp + 2, 0);
    reset();
    tickCpu();
    expect(getState().STR & ST_OV).toBe(ST_OV);
    expect(getState().R[0]).toBe(0x0001);
    expect(getState().R[1]).toBe(0);
  });

  it("SBO #1 on CRU 1EE1 enables decrementer flag", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    const wp = 0x0100;
    pokeWord(0, wp);
    pokeWord(2, 0x0200);
    pokeWord(0x0200, 0x1d01);
    pokeWord(wp + 12 * 2, 0x1ee0);
    reset();
    tickCpu();
    expect(getExecStatus()).toBe("running");
    expect(getDecrementerEnabled()).toBe(true);
  });
});
