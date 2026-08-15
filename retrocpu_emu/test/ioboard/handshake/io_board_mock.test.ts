/**
 * IoBoardHandshakeMock — ハンドラ／IRQ2 連動（線上の CPU 側はアセンブラ）
 * 根拠: HandShake.mdc
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CpuToIoCommandDispatcher } from "../../../src/ioboard/handshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../../src/shared/handshake/handshake_type";
import {
  createDefaultCpuToIoHandlers,
  createIoBoardHandshakeMock,
  IoBoardHandshakeMock,
} from "../../../src/ioboard/handshake/io_board_mock";
import {
  IoTimeCounter,
  IO_TIME_TICK_NS,
} from "../../../src/ioboard/timer/io_time";
import {
  getPendingIrq,
  getPins,
  reset,
  setPins,
} from "../../../src/cpuboard/mn1613/mn1613";

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

  it("モード設定(0x10)で state.mode を更新する", () => {
    const resp = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.MODE_SET, MODE.FREE]),
    );
    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.mode).toBe(MODE.FREE);
  });

  it("BEEP(0x14)で lastBeep を保持する", () => {
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

  it("時刻取得(0x11)は timeSource があればそのティックを返す", () => {
    let now = 0n;
    const clock = new IoTimeCounter({ nowNs: () => now });
    clock.reset();
    now = 4n * IO_TIME_TICK_NS;
    const d = new CpuToIoCommandDispatcher(
      createDefaultCpuToIoHandlers(mock.state, mock.timers, clock),
    );
    const resp = d.dispatch(new Uint8Array([CMD_CPU_TO_IO.TIME_GET]));
    expect([...resp.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 4]);
    expect(resp[8]).toBe(RESPONSE_CODE.OK);
  });

  it("未定義命令LED(0x13)で state.undefLed を更新する", () => {
    expect(mock.state.undefLed).toBe(false);
    const on = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.UNDEF_LED, 1]),
    );
    expect(on[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.undefLed).toBe(true);
    const off = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.UNDEF_LED, 0]),
    );
    expect(off[0]).toBe(RESPONSE_CODE.OK);
    expect(mock.state.undefLed).toBe(false);
  });
});
