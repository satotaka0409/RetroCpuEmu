/**
 * TMS9995 IO→CPU ハンドシェイク割込配線の単体試験。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CPU_TYPE } from "../../../src/ioboard/setting_area";
import { wireHshkInReqToCpuIrq } from "../../../src/cpuboard/cpu_hshk_wire";
import {
  CPU_PORT_MODE,
  attachHandshakeBus,
  attachIoBoardPorts,
  setCpuPortMode,
  tms9995CpuReadCruBit,
} from "../../../src/cpuboard/io_ports";
import { TMS9995_CRU_HANDSHAKE_SIGNALS } from "../../../src/cpuboard/tms9995";
import {
  INT_CAUSE_CODE,
  createHandshakeBus,
} from "../../../src/shared/handshake/handshake_type";
import {
  getExecStatus,
  powerOnIdle,
  setMemory,
  tickCpu,
} from "../../../src/cpuboard/tms9995/tms9995";
import { TMS_MEM_BYTES } from "../../../src/cpuboard/tms9995/types";

describe("wireHshkInReqToCpuIrq (TMS9995)", () => {
  let unwire: (() => void) | null = null;

  beforeEach(() => {
    setMemory(new ArrayBuffer(TMS_MEM_BYTES));
    powerOnIdle();
    attachIoBoardPorts();
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
  });

  afterEach(() => {
    unwire?.();
    unwire = null;
    attachHandshakeBus(null);
  });

  it("HSHK_IN_REQ で INT1_CAUSE=1 を載せ IRQ1 を要求する", () => {
    const bus = createHandshakeBus();
    attachHandshakeBus(bus);
    unwire = wireHshkInReqToCpuIrq(bus, CPU_TYPE.TMS9995);

    bus.INT_CAUSE = INT_CAUSE_CODE.HANDSHAKE;
    bus.HSHK_IN_REQ = 1;

    expect(
      tms9995CpuReadCruBit(TMS9995_CRU_HANDSHAKE_SIGNALS.INT1_CAUSE),
    ).toBe(1);
    for (let i = 0; i < 64; i += 1) tickCpu();
    expect(getExecStatus()).not.toBe("running");
  });
});
