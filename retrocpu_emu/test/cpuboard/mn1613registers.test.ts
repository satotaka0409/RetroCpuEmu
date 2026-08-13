/**
 * mn1613registers の格納型ヘルパ
 * 根拠: mn1613_register.png（下位4bit セグメント / IISR 下位1bit）
 */
import { describe, it, expect } from "vitest";
import {
  fromReg4,
  fromReg16,
  fromReg24,
  reg4,
  reg16,
  reg24,
  type CpuRegisters,
} from "../../src/cpuboard/mn1613/mn1613registers";

/**
 * 型チェック用の初期レジスタ一式を作る。
 * @returns ゼロ初期化の CpuRegisters
 */
function zeroRegisters(): CpuRegisters {
  return {
    R0: reg16(0),
    R1: reg16(0),
    R2: reg16(0),
    R3: reg16(0),
    R4: reg16(0),
    SP: reg24(0),
    STR: reg24(0),
    IC: reg16(0),
    CSBR: reg4(0),
    SSBR: reg4(0),
    TSR0: reg4(0),
    TSR1: reg4(0),
    OSR0: reg4(0),
    OSR1: reg4(0),
    OSR2: reg4(0),
    OSR3: reg4(0),
    NPP: reg16(1),
    IISR: false,
    SBRB: reg4(0),
    ICB: reg16(0),
  };
}

describe("mn1613registers helpers", () => {
  it("reg16 / fromReg16 は 16bit を保持し上位を捨てる", () => {
    const a = reg16(0x1_2345);
    expect(a).toBeInstanceOf(Uint16Array);
    expect(a.length).toBe(1);
    expect(a[0]).toBe(0x2345);
    expect(fromReg16(a)).toBe(0x2345);
    expect(fromReg16(new Uint16Array())).toBe(0);
  });

  it("reg24 / fromReg24 は上位8+下位16 に分割する", () => {
    const a = reg24(0x12_3456);
    expect(a).toBeInstanceOf(Uint16Array);
    expect(a.length).toBe(2);
    expect(a[0]).toBe(0x12);
    expect(a[1]).toBe(0x3456);
    expect(fromReg24(a)).toBe(0x12_3456);
    expect(fromReg24(reg24(0x100_0000))).toBe(0);
  });

  it("reg4 / fromReg4 は下位4bit のみ Uint8Array に載せる", () => {
    const a = reg4(0xab);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(1);
    expect(a[0]).toBe(0xb);
    expect(fromReg4(a)).toBe(0xb);
    expect(fromReg4(reg4(0xffff))).toBe(0xf);
    expect(fromReg4(new Uint8Array())).toBe(0);
  });

  it("CpuRegisters のセグメント系は Uint8Array、IISR は boolean", () => {
    const r = zeroRegisters();
    r.CSBR = reg4(0x15);
    r.SSBR = reg4(2);
    r.TSR0 = reg4(3);
    r.TSR1 = reg4(4);
    r.OSR0 = reg4(5);
    r.OSR1 = reg4(6);
    r.OSR2 = reg4(7);
    r.OSR3 = reg4(8);
    r.SBRB = reg4(9);
    r.IISR = true;

    expect(r.CSBR).toBeInstanceOf(Uint8Array);
    expect(fromReg4(r.CSBR)).toBe(0x5);
    expect(fromReg4(r.SSBR)).toBe(2);
    expect(fromReg4(r.TSR0)).toBe(3);
    expect(fromReg4(r.TSR1)).toBe(4);
    expect(fromReg4(r.OSR0)).toBe(5);
    expect(fromReg4(r.OSR1)).toBe(6);
    expect(fromReg4(r.OSR2)).toBe(7);
    expect(fromReg4(r.OSR3)).toBe(8);
    expect(fromReg4(r.SBRB)).toBe(9);
    expect(r.IISR).toBe(true);
    expect(typeof r.IISR).toBe("boolean");
    expect(r.SP).toBeInstanceOf(Uint16Array);
    expect(r.SP.length).toBe(2);
    expect(r.R0).toBeInstanceOf(Uint16Array);
  });
});
