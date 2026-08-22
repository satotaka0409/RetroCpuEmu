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
  tms9995CpuReadCruDataByte,
  tms9995CpuWriteCruBit,
  tms9995CpuWriteCruDataByte,
  tms9995MemReadIoByte,
  tms9995MemWriteIoByte,
} from "../../src/cpuboard/io_ports";
import {
  TMS9995_CRU_HANDSHAKE_SIGNALS,
  TMS9995_IO_BREAK_ADDR_HI,
  TMS9995_IO_BREAK_ADDR_LO,
  TMS9995_IO_BREAK_CTRL,
  TMS9995_IO_BREAK_SLOT,
} from "../../src/cpuboard/tms9995";
import { INT_CAUSE_CODE } from "../../src/shared/handshake/handshake_type";

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

  it("TMS9995モードでは HANDSHAKE が INT1_CAUSE に載る", () => {
    const bus = makeBus();
    attachHandshakeBus(bus);
    setCpuPortMode(CPU_PORT_MODE.TMS9995);

    setIntCause(INT_CAUSE_CODE.HANDSHAKE);

    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT1_CAUSE),
    ).toBe(1);
    expect(tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT2_CAUSE)).toBe(
      0,
    );
  });

  it("TMS9995モードでは STEP が INT2_CAUSE=1 に載る", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    setIntCause(INT_CAUSE_CODE.STEP);

    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT1_CAUSE),
    ).toBe(0);
    expect(tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT2_CAUSE)).toBe(
      1,
    );
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

  it("TMS9995モードでは FE80 メモリ IO を設定できる", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    expect(tms9995MemWriteIoByte(TMS9995_IO_BREAK_SLOT, 0)).toBe(true);
    expect(tms9995MemWriteIoByte(TMS9995_IO_BREAK_CTRL, 1 << 3)).toBe(true);
    expect(tms9995MemWriteIoByte(TMS9995_IO_BREAK_ADDR_HI, 0x00)).toBe(true);
    expect(tms9995MemWriteIoByte(TMS9995_IO_BREAK_ADDR_LO, 0x10)).toBe(true);
    expect(tms9995MemReadIoByte(TMS9995_IO_BREAK_SLOT)).toBe(0);
  });

  it("TMS9995モードでは HSHK_IN_DATA ラッチを STCR 用に読める", () => {
    const bus = makeBus();
    bus.HSHK_IN_DATA = 0x3c;
    attachHandshakeBus(bus);
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    expect(tms9995CpuReadCruDataByte()).toBe(0x3c);
  });

  it("TMS9995モードではタイマー CRU 1EE1 へ SBO 相当の書込ができる", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    tms9995CpuWriteCruBit(0x1ee1, 1);
    expect(tms9995CpuReadCruBit(0x1ee1)).toBe(1);
  });

  it("TMS9995モードではタイマー CRU 1EE1 へ SBZ 相当で無効化できる", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    tms9995CpuWriteCruBit(0x1ee1, 1);
    tms9995CpuWriteCruBit(0x1ee1, 0);
    expect(tms9995CpuReadCruBit(0x1ee1)).toBe(0);
  });

  it("TMS9995モードでは LDCR データバイトがバス HSHK_OUT_DATA に反映される", () => {
    const bus = makeBus();
    attachHandshakeBus(bus);
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    tms9995CpuWriteCruDataByte(0xa5);
    expect(bus.HSHK_OUT_DATA).toBe(0xa5);
  });

  it("TMS9995モードでは CRU 書込後も MN1613 モードへ戻せる", () => {
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    tms9995CpuWriteCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ, 1);
    setCpuPortMode(CPU_PORT_MODE.MN1613);
    expect(getCpuPortMode()).toBe(CPU_PORT_MODE.MN1613);
    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.HSHK_OUT_REQ),
    ).toBe(0);
  });
});
