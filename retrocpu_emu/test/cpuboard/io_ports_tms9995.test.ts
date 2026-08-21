import { beforeEach, describe, expect, it } from "vitest";
import type { CpuIoSignals } from "../../src/cpuboard/mn1613/mn1613ioport";
import {
  CPU_PORT_MODE,
  attachHandshakeBus,
  getCpuPortMode,
  getInterruptBusy,
  isHandshakeActive,
  setCpuPortMode,
  setIntCause,
  tms9995CpuReadCruBit,
  tms9995CpuWriteCruBit,
} from "../../src/cpuboard/io_ports";
import { TMS9995_CRU_HANDSHAKE_SIGNALS } from "../../src/cpuboard/tms9995";

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

describe("io_ports TMS9995 mode", () => {
  beforeEach(() => {
    attachHandshakeBus(makeBus());
    setCpuPortMode(CPU_PORT_MODE.MN1613);
    setIntCause(0);
  });

  it("CPU種別で配線モードを切り替えられる", () => {
    setCpuPortMode(2);
    expect(getCpuPortMode()).toBe(CPU_PORT_MODE.TMS9995);

    setCpuPortMode(1);
    expect(getCpuPortMode()).toBe(CPU_PORT_MODE.MN1613);

    setCpuPortMode(0xff);
    expect(getCpuPortMode()).toBe(CPU_PORT_MODE.MN1613);
  });

  it("TMS9995モードでは INT_CAUSE が CRU に反映される", () => {
    const bus = makeBus();
    attachHandshakeBus(bus);
    setCpuPortMode(CPU_PORT_MODE.TMS9995);

    // bit0=1, bit1=1 -> INT1=3, INT2=1 の状態
    setIntCause(0x03);

    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT1_CAUSE0),
    ).toBe(1);
    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT1_CAUSE1),
    ).toBe(1);
    expect(tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT2_CAUSE)).toBe(
      1,
    );
    expect(bus.INT_CAUSE).toBe(0x03);
  });

  it("TMS9995モードでは BUSY を CRU 経由で読める", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    tms9995CpuWriteCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INTERRUPT_BUSY, 1);

    expect(getInterruptBusy()).toBe(1);
  });

  it("TMS9995モードのハンドシェイク活性判定は CRU 線を見る", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    expect(isHandshakeActive()).toBe(false);

    tms9995CpuWriteCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ, 1);
    expect(isHandshakeActive()).toBe(true);

    tms9995CpuWriteCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ, 0);
    expect(isHandshakeActive()).toBe(false);
  });

  it("MN1613モードでは tms9995CpuReadCruBit は 0 を返す", () => {
    setCpuPortMode(CPU_PORT_MODE.MN1613);
    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_IN_REQ),
    ).toBe(0);
  });
});
