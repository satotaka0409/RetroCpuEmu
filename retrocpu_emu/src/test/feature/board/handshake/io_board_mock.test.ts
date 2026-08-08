/**
 * IoBoardHandshakeMock — ハンドラ／IRQ2 連動（線上の CPU 側はアセンブラ）
 * 根拠: HandShake.mdc
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CpuToIoCommandDispatcher } from "../../../../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../../../main/feature/cpu/mn1613/handhshake/handshake_type";
import {
  createDefaultCpuToIoHandlers,
  createIoBoardHandshakeMock,
  IoBoardHandshakeMock,
} from "../../../../main/feature/board/handshake/io_board_mock";
import {
  getPendingIrq,
  getPins,
  reset,
  setPins,
} from "../../../../main/feature/cpu/mn1613/mn1613";

/** IRQ2 のペンディングビット */
const IRQ2_BIT = 0x04;

describe("IoBoardHandshakeMock", () => {
  let mock: IoBoardHandshakeMock;
  let dispatcher: CpuToIoCommandDispatcher;

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
    reset();
    mock = createIoBoardHandshakeMock({ timeoutMs: 1000 });
    dispatcher = new CpuToIoCommandDispatcher(
      createDefaultCpuToIoHandlers(mock.state, mock.timers),
    );
  });

  afterEach(async () => {
    await mock.stop();
    mock.detach();
  });

  it("モード設定(0x11)で state.mode を更新する", () => {
    const resp = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.MODE_SET, MODE.FREE]),
    );
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.mode).toBe(MODE.FREE);
  });

  it("CPU状態通知(0x10)で lastCpuRegs を保持する", () => {
    const frame = new Uint8Array(0x29);
    frame[0] = CMD_CPU_TO_IO.CPU_STATUS_NOTIFY;
    frame[1] = 0x11;
    frame[2] = 0x11;
    frame[0x11] = 0x02;
    frame[0x12] = 0x00;
    const resp = dispatcher.dispatch(frame);
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.lastCpuRegs).not.toBeNull();
    expect(Number(mock.state.lastCpuRegs!.R0)).toBe(0x1111);
    expect(Number(mock.state.lastCpuRegs!.IC)).toBe(0x0200);
  });

  it("BEEP(0x18)で lastBeep を保持する", () => {
    const resp = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x01, 0xb8, 0x00, 0x64]),
    );
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.lastBeep).toEqual({ frequencyHz: 440, durationMs: 100 });
  });

  it("HSHK_REQ_1 → IRQ2 / pending が立つ", () => {
    mock.bus.HSHK_REQ_1 = 1;
    expect(getPins().IRQ2).toBe(true);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
  });

  it("フリーモード時のみ hex key が OK", () => {
    mock.setHexKeys([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]);

    const ng = dispatcher.dispatch(new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]));
    expect(ng[8]).toBe(RESPONSE_CODE.NG_MODE_ERROR);

    dispatcher.dispatch(new Uint8Array([CMD_CPU_TO_IO.MODE_SET, MODE.FREE]));

    const ok = dispatcher.dispatch(new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]));
    expect([...ok.slice(0, 8)]).toEqual([
      0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80,
    ]);
    expect(ok[8]).toBe(RESPONSE_CODE.OK);
  });
});
