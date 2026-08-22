/**
 * TMS9995 CRU ハンドシェイク領域モックのユニットテスト。
 */

import {
  Tms9995CruHandshakeMock,
  TMS9995_CRU_HANDSHAKE_REGION,
  TMS9995_CRU_HANDSHAKE_SIGNALS,
} from "../src/tms9995/cru_handshake.js";
import { expect, test } from "../src/unit.js";

test("CPU→IO の信号とデータをモック越しに読み取れる", () => {
  const cru = new Tms9995CruHandshakeMock();

  cru.cpuWriteSignal("HSHK_OUT_REQ", 1);
  cru.cpuWriteSignal("HSHK_OUT_DENA", 1);
  cru.cpuWriteOutDataByte(0xa5);

  expect(cru.ioReadSignal("HSHK_OUT_REQ")).toBe(1);
  expect(cru.ioReadSignal("HSHK_OUT_DENA")).toBe(1);
  expect(cru.ioReadOutDataByte()).toBe(0xa5);
});

test("IO→CPU の信号とデータをモック越しに読み取れる", () => {
  const cru = new Tms9995CruHandshakeMock();

  cru.ioWriteSignal("HSHK_IN_REQ", 1);
  cru.ioWriteSignal("HSHK_IN_DENA", 1);
  cru.ioWriteInDataByte(0x3c);

  expect(cru.cpuReadSignal("HSHK_IN_REQ")).toBe(1);
  expect(cru.cpuReadSignal("HSHK_IN_DENA")).toBe(1);
  expect(cru.cpuReadInDataByte()).toBe(0x3c);
});

test("strictRoles=true では役割外アクセスを拒否する", () => {
  const cru = new Tms9995CruHandshakeMock();

  expect(() => cru.writeBit("cpu", 0x0024, 1)).toThrow(/cannot write/);
  expect(() => cru.writeBit("io", 0x0020, 1)).toThrow(/cannot write/);
  expect(() => cru.readBit("cpu", 0x0020)).toThrow(/cannot read/);
  expect(() => cru.readBit("io", 0x0024)).toThrow(/cannot read/);
});

test("strictRoles=false ならハンドシェイク領域内の読み書きを許可する", () => {
  const cru = new Tms9995CruHandshakeMock({ strictRoles: false });

  cru.writeBit("cpu", 0x0024, 1);
  expect(cru.readBit("io", 0x0024)).toBe(1);
});

test("snapshot は信号・データ・領域範囲を一貫して返す", () => {
  const cru = new Tms9995CruHandshakeMock();
  cru.cpuWriteSignal("HSHK_OUT_DENA", 1);
  cru.cpuWriteOutDataByte(0x81);
  cru.ioWriteSignal("HSHK_OUT_DACK", 1);
  cru.ioWriteInDataByte(0x42);

  const snap = cru.snapshot();
  expect(snap.cpuOutSignals.HSHK_OUT_DENA).toBe(1);
  expect(snap.cpuInSignals.HSHK_OUT_DACK).toBe(1);
  expect(snap.outDataByte).toBe(0x81);
  expect(snap.inDataByte).toBe(0x42);
  expect(snap.bits["0x0023"]).toBe(1);
  expect(snap.bits["0x0027"]).toBe(0);

  expect(TMS9995_CRU_HANDSHAKE_REGION.bitAddrMin).toBe(0x0010);
  expect(TMS9995_CRU_HANDSHAKE_REGION.bitAddrMax).toBe(0x0027);
  expect(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ).toBe(0x0020);
  expect(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_IN_DACK).toBe(0x0022);
  expect(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_DACK).toBe(0x0026);
  expect(TMS9995_CRU_HANDSHAKE_SIGNALS.INTERRUPT_BUSY).toBe(0x0010);
  expect(TMS9995_CRU_HANDSHAKE_SIGNALS.INT2_CAUSE).toBe(0x0012);
});

test("INT1/INT2 要因を IO がセットし CPU が読める", () => {
  const cru = new Tms9995CruHandshakeMock();
  cru.ioSetInt1Cause(1); // handshake
  expect(cru.cpuReadInt1Cause()).toBe(1);
  cru.ioSetInt2Cause(1); // step
  expect(cru.cpuReadInt2Cause()).toBe(1);
  cru.cpuWriteSignal("INTERRUPT_BUSY", 1);
  expect(cru.ioReadSignal("INTERRUPT_BUSY")).toBe(1);
});
