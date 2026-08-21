import { describe, expect, it } from "vitest";
import {
  TMS9995_CRU_HANDSHAKE_REGION,
  TMS9995_CRU_HANDSHAKE_SIGNALS,
  Tms9995CruHandshake,
} from "../../../src/cpuboard/tms9995";

describe("Tms9995CruHandshake", () => {
  it("初期化時は全ビットが 0", () => {
    const cru = new Tms9995CruHandshake();
    const s = cru.snapshot();

    expect(s.cpuOutSignals.HSHK_OUT_REQ).toBe(0);
    expect(s.cpuOutSignals.HSHK_OUT_DENA).toBe(0);
    expect(s.cpuOutSignals.HSHK_IN_DACK).toBe(0);
    expect(s.cpuOutSignals.INTERRUPT_BUSY).toBe(0);

    expect(s.cpuInSignals.HSHK_IN_REQ).toBe(0);
    expect(s.cpuInSignals.HSHK_IN_DENA).toBe(0);
    expect(s.cpuInSignals.HSHK_OUT_DACK).toBe(0);
    expect(s.cpuInSignals.INT1_CAUSE0).toBe(0);
    expect(s.cpuInSignals.INT1_CAUSE1).toBe(0);
    expect(s.cpuInSignals.INT2_CAUSE).toBe(0);

    expect(s.outDataByte).toBe(0);
    expect(s.inDataByte).toBe(0);
    expect(s.bits["0x0020"]).toBe(0);
    expect(s.bits["0x003F"]).toBe(0);
  });

  it("CPU出力線は IO 側から読める", () => {
    const cru = new Tms9995CruHandshake();

    cru.cpuWriteSignal("HSHK_OUT_REQ", 1);
    cru.cpuWriteSignal("HSHK_OUT_DENA", 1);
    cru.cpuWriteSignal("HSHK_IN_DACK", 0);

    expect(cru.ioReadSignal("HSHK_OUT_REQ")).toBe(1);
    expect(cru.ioReadSignal("HSHK_OUT_DENA")).toBe(1);
    expect(cru.ioReadSignal("HSHK_IN_DACK")).toBe(0);
  });

  it("IO入力線は CPU 側から読める", () => {
    const cru = new Tms9995CruHandshake();

    cru.ioWriteSignal("HSHK_IN_REQ", 1);
    cru.ioWriteSignal("HSHK_IN_DENA", 1);
    cru.ioWriteSignal("HSHK_OUT_DACK", 0);

    expect(cru.cpuReadSignal("HSHK_IN_REQ")).toBe(1);
    expect(cru.cpuReadSignal("HSHK_IN_DENA")).toBe(1);
    expect(cru.cpuReadSignal("HSHK_OUT_DACK")).toBe(0);
  });

  it("INT1/INT2要因線を CRU ビットで扱える", () => {
    const cru = new Tms9995CruHandshake();

    cru.ioSetInt1Cause(2);
    cru.ioSetInt2Cause(1);

    expect(cru.cpuReadInt1Cause()).toBe(2);
    expect(cru.cpuReadInt2Cause()).toBe(1);
  });

  it("OUT_DATA と IN_DATA を 8bit 単位で転送できる", () => {
    const cru = new Tms9995CruHandshake();

    cru.cpuWriteOutDataByte(0xa5);
    cru.ioWriteInDataByte(0x3c);

    expect(cru.ioReadOutDataByte()).toBe(0xa5);
    expect(cru.cpuReadInDataByte()).toBe(0x3c);
  });

  it("strictRoles=true では逆方向の書き込みはエラー", () => {
    const cru = new Tms9995CruHandshake({ strictRoles: true });

    expect(() =>
      cru.writeBit("cpu", TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_IN_REQ, 1),
    ).toThrow(/cannot write/i);
    expect(() =>
      cru.writeBit("io", TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ, 1),
    ).toThrow(/cannot write/i);
  });

  it("strictRoles=true では逆方向の読み出しはエラー", () => {
    const cru = new Tms9995CruHandshake({ strictRoles: true });

    expect(() =>
      cru.readBit("cpu", TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ),
    ).toThrow(/cannot read/i);
    expect(() =>
      cru.readBit("io", TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_IN_REQ),
    ).toThrow(/cannot read/i);
  });

  it("領域外ビットアクセスはエラー", () => {
    const cru = new Tms9995CruHandshake();

    expect(() =>
      cru.writeBit("cpu", TMS9995_CRU_HANDSHAKE_REGION.bitAddrMin - 1, 1),
    ).toThrow(/out of handshake region/i);
    expect(() =>
      cru.readBit("io", TMS9995_CRU_HANDSHAKE_REGION.bitAddrMax + 1),
    ).toThrow(/out of handshake region/i);
  });

  it("read/write ログを保持し reset でクリアされる", () => {
    const cru = new Tms9995CruHandshake();

    cru.cpuWriteSignal("HSHK_OUT_REQ", 1);
    cru.ioWriteSignal("HSHK_IN_REQ", 1);
    cru.ioReadSignal("HSHK_OUT_REQ");
    cru.cpuReadSignal("HSHK_IN_REQ");

    expect(cru.writes.length).toBe(2);
    expect(cru.reads.length).toBe(2);

    cru.reset();

    expect(cru.writes.length).toBe(0);
    expect(cru.reads.length).toBe(0);
    expect(cru.snapshot().bits["0x0024"]).toBe(0);
    expect(cru.snapshot().bits["0x0028"]).toBe(0);
  });
});
