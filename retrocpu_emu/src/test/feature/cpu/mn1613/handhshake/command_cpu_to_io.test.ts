/**
 * command_cpu_to_io.ts テスト（I/O ボード側ディスパッチャ）
 *
 * フレーム構築は CPU ボードのアセンブラが行う。ここでは
 * HandShake.mdc の位置表に合わせた生バイト列を dispatch する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CPU_FRAME_SIZE,
  CPU_PAYLOAD_REMAINING_SIZE,
  CpuToIoCommandDispatcher,
  type CpuRegisters,
  type CpuToIoHandlers,
  reg16,
  reg24,
} from "../../../../../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_type";

/** テスト用 CPU レジスタ値（各フィールドを一意にして位置ミスを検出する） */
const SAMPLE_REGS: CpuRegisters = {
  R0: reg16(0x1234),
  R1: reg16(0x2345),
  R2: reg16(0x3456),
  R3: reg16(0x4567),
  R4: reg16(0x5678),
  SP: reg24(0xabcdef),
  STR: reg24(0x123456),
  IC: reg16(0x789a),
  CSBR: reg16(0xbcde),
  SSBR: reg16(0xdef0),
  TSR0: reg16(0x1122),
  TSR1: reg16(0x3344),
  OSR0: reg16(0x5566),
  OSR1: reg16(0x77),
  OSR2: reg24(0x889900),
  NPP: reg16(0xaa),
  IISR: reg16(0xbb),
  SBRB: reg16(0xcc),
  ICB: reg16(0xddee),
};

/** HandShake.mdc 位置表に合わせた CPU 状態通知 (0x10) フレーム */
const CPU_STATUS_FRAME = new Uint8Array([
  0x10, 0x12, 0x34, 0x23, 0x45, 0x34, 0x56, 0x45, 0x67, 0x56, 0x78, 0xab,
  0xcd, 0xef, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xde, 0xf0, 0x11,
  0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0x00, 0xaa, 0x00, 0x00,
  0xbb, 0x00, 0xcc, 0xdd, 0xee,
]);

/**
 * モックハンドラを生成する。
 * @returns vi.fn で埋めた CpuToIoHandlers
 */
function makeMockHandlers(): CpuToIoHandlers {
  return {
    onCpuStatusNotify: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onModeSet: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    getHexKeys: vi.fn().mockReturnValue({
      columns: new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]),
      status: RESPONSE_CODE.OK,
    }),
    getPcKey: vi.fn().mockReturnValue({
      ascii: 0x41,
      keyCode: 0x41,
      status: RESPONSE_CODE.OK,
    }),
    onLedDisplay: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onBeep: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onTimerSet: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    getAddrBreakInfo: vi.fn().mockReturnValue({
      breakNo: 0,
      timestamp: new Uint8Array(8),
      status: RESPONSE_CODE.OK,
    }),
  };
}

describe("CPU_FRAME_SIZE", () => {
  it("CPU状態通知は 41(0x29) バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.CPU_STATUS_NOTIFY]).toBe(0x29);
  });
  it("モード設定は 2 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.MODE_SET]).toBe(2);
  });
  it("16進キー・PCキー取得はコマンドのみ 1 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.HEX_KEY_GET]).toBe(1);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.PC_KEY_GET]).toBe(1);
  });
  it("LED表示依頼は 15 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.LED_DISPLAY]).toBe(15);
  });
  it("BEEP は 5 バイト、タイマーは番号込みで 6 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.BEEP]).toBe(5);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIMER_SET]).toBe(6);
  });
});

describe("CPU_PAYLOAD_REMAINING_SIZE", () => {
  it("各コマンドの残余サイズは (フレームサイズ - 1) と一致する", () => {
    for (const cmd of Object.keys(CPU_FRAME_SIZE).map(Number)) {
      expect(CPU_PAYLOAD_REMAINING_SIZE[cmd]).toBe(CPU_FRAME_SIZE[cmd] - 1);
    }
  });
});

describe("CpuToIoCommandDispatcher — CPU状態通知(0x10)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onCpuStatusNotify が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(CPU_STATUS_FRAME);
    expect(handlers.onCpuStatusNotify).toHaveBeenCalledOnce();
    expect(response).toEqual(new Uint8Array([RESPONSE_CODE.OK]));
  });

  it("onCpuStatusNotify に渡されるレジスタ値が正確", () => {
    dispatcher.dispatch(CPU_STATUS_FRAME);
    const received = vi.mocked(handlers.onCpuStatusNotify).mock.calls[0][0];
    expect(received.R0).toEqual(SAMPLE_REGS.R0);
    expect(received.SP).toEqual(SAMPLE_REGS.SP);
    expect(received.STR).toEqual(SAMPLE_REGS.STR);
    expect(received.OSR1).toEqual(SAMPLE_REGS.OSR1);
    expect(received.OSR2).toEqual(SAMPLE_REGS.OSR2);
    expect(received.NPP).toEqual(SAMPLE_REGS.NPP);
    expect(received.IISR).toEqual(SAMPLE_REGS.IISR);
    expect(received.SBRB).toEqual(SAMPLE_REGS.SBRB);
    expect(received.ICB).toEqual(SAMPLE_REGS.ICB);
  });

  it("ハンドラが NG を返した場合、応答も NG", () => {
    vi.mocked(handlers.onCpuStatusNotify).mockReturnValue(RESPONSE_CODE.NG);
    const response = dispatcher.dispatch(CPU_STATUS_FRAME);
    expect(response[0]).toBe(RESPONSE_CODE.NG);
  });

  it("フレームが短すぎる場合は NG を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.CPU_STATUS_NOTIFY]),
    );
    expect(response[0]).toBe(RESPONSE_CODE.NG);
    expect(handlers.onCpuStatusNotify).not.toHaveBeenCalled();
  });
});

describe("CpuToIoCommandDispatcher — モード設定(0x11)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("モニターモード(0)で onModeSet(0) が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.MODE_SET, MODE.MONITOR]),
    );
    expect(handlers.onModeSet).toHaveBeenCalledWith(MODE.MONITOR);
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("フリーモード(1)で onModeSet(1) が呼ばれる", () => {
    dispatcher.dispatch(new Uint8Array([CMD_CPU_TO_IO.MODE_SET, MODE.FREE]));
    expect(handlers.onModeSet).toHaveBeenCalledWith(MODE.FREE);
  });

  it("無効なモード値(2)を送ると NG を返し onModeSet は呼ばれない", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.MODE_SET, 2]),
    );
    expect(response[0]).toBe(RESPONSE_CODE.NG);
    expect(handlers.onModeSet).not.toHaveBeenCalled();
  });
});

describe("CpuToIoCommandDispatcher — 16進キー入力取得(0x14)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("getHexKeys が呼ばれ 9バイト(列0〜7 + ステータス)を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]),
    );
    expect(handlers.getHexKeys).toHaveBeenCalledOnce();
    expect(response.length).toBe(9);
    expect(response[8]).toBe(RESPONSE_CODE.OK);
  });

  it("各列のキー値が応答バイト 0〜7 に格納される", () => {
    const columns = new Uint8Array([
      0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80,
    ]);
    vi.mocked(handlers.getHexKeys).mockReturnValue({
      columns,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]),
    );
    expect(Array.from(response.slice(0, 8))).toEqual(Array.from(columns));
  });

  it("モードエラーの場合 NG(0x01) を返す", () => {
    vi.mocked(handlers.getHexKeys).mockReturnValue({
      columns: new Uint8Array(8),
      status: RESPONSE_CODE.NG_MODE_ERROR,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.HEX_KEY_GET]),
    );
    expect(response[8]).toBe(RESPONSE_CODE.NG_MODE_ERROR);
  });
});

describe("CpuToIoCommandDispatcher — PCキー入力取得(0x15)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("getPcKey が呼ばれ 3バイト(ASCII + キーコード + ステータス)を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.PC_KEY_GET]),
    );
    expect(handlers.getPcKey).toHaveBeenCalledOnce();
    expect(response.length).toBe(3);
  });

  it("ASCII値・キーコード・ステータスが正しく格納される", () => {
    vi.mocked(handlers.getPcKey).mockReturnValue({
      ascii: 0x41,
      keyCode: 0x26,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.PC_KEY_GET]),
    );
    expect(response[0]).toBe(0x41);
    expect(response[1]).toBe(0x26);
    expect(response[2]).toBe(RESPONSE_CODE.OK);
  });
});

describe("CpuToIoCommandDispatcher — LED表示依頼(0x16)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;
  const sevenSeg = new Uint8Array([
    0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c,
  ]);

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  /**
   * LED 表示依頼フレームを組み立てる。
   * @param bullet0_7 砲弾 0–7
   * @param bullet8_F 砲弾 8–F
   * @returns cmd 0x16 + 7seg×12 + 砲弾 2 バイト
   */
  function ledFrame(bullet0_7: number, bullet8_F: number): Uint8Array {
    const frame = new Uint8Array(15);
    frame[0] = CMD_CPU_TO_IO.LED_DISPLAY;
    frame.set(sevenSeg, 1);
    frame[13] = bullet0_7;
    frame[14] = bullet8_F;
    return frame;
  }

  it("onLedDisplay が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(ledFrame(0xff, 0x00));
    expect(handlers.onLedDisplay).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onLedDisplay に渡される sevenSeg・bulletLed が正確", () => {
    dispatcher.dispatch(ledFrame(0xab, 0xcd));
    const received = vi.mocked(handlers.onLedDisplay).mock.calls[0][0];
    expect(Array.from(received.sevenSeg)).toEqual(Array.from(sevenSeg));
    expect(received.bulletLed0_7).toBe(0xab);
    expect(received.bulletLed8_F).toBe(0xcd);
  });
});

describe("CpuToIoCommandDispatcher — BEEP音(0x18)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onBeep が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x01, 0xb8, 0x01, 0xf4]),
    );
    expect(handlers.onBeep).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onBeep に渡される周波数・長さが正確", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x12, 0x34, 0xab, 0xcd]),
    );
    const received = vi.mocked(handlers.onBeep).mock.calls[0][0];
    expect(received.frequencyHz).toBe(0x1234);
    expect(received.durationMs).toBe(0xabcd);
  });

  it("frequencyHz=0 は停止指示として正しく渡される", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x00, 0x00, 0x00, 0x00]),
    );
    const received = vi.mocked(handlers.onBeep).mock.calls[0][0];
    expect(received.frequencyHz).toBe(0);
  });
});

describe("CpuToIoCommandDispatcher — タイマー設定(0x19)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onTimerSet が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x00, 0x00, 0x64, 0x00, 0x0a]),
    );
    expect(handlers.onTimerSet).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onTimerSet に渡されるタイマー番号・周期・回数が正確", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x01, 0x12, 0x34, 0xab, 0xcd]),
    );
    const received = vi.mocked(handlers.onTimerSet).mock.calls[0][0];
    expect(received.timerNo).toBe(1);
    expect(received.periodMs).toBe(0x1234);
    expect(received.count).toBe(0xabcd);
  });

  it("count=0 は無限繰り返しとして正しく渡される", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x00, 0x00, 0x64, 0x00, 0x00]),
    );
    const received = vi.mocked(handlers.onTimerSet).mock.calls[0][0];
    expect(received.count).toBe(0);
  });

  it("タイマー番号が 0/1 以外なら NG（ハンドラは呼ばない）", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x02, 0x00, 0x64, 0x00, 0x00]),
    );
    expect(response[0]).toBe(RESPONSE_CODE.NG);
    expect(handlers.onTimerSet).not.toHaveBeenCalled();
  });
});

describe("CpuToIoCommandDispatcher — エラーケース", () => {
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    dispatcher = new CpuToIoCommandDispatcher(makeMockHandlers());
  });

  it("空フレームは NG を返す", () => {
    expect(dispatcher.dispatch(new Uint8Array(0))[0]).toBe(RESPONSE_CODE.NG);
  });

  it("未知のコマンドバイトは NG を返す", () => {
    expect(dispatcher.dispatch(new Uint8Array([0xff]))[0]).toBe(
      RESPONSE_CODE.NG,
    );
  });

  it("フレーム長が不足している場合は NG を返す（LED表示 - 1バイト）", () => {
    const short = new Uint8Array([CMD_CPU_TO_IO.LED_DISPLAY, 0x00]);
    expect(dispatcher.dispatch(short)[0]).toBe(RESPONSE_CODE.NG);
  });

  it("フレーム長が不足している場合は NG を返す（BEEP - 4バイト）", () => {
    const short = new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x00, 0x01, 0x00]);
    expect(dispatcher.dispatch(short)[0]).toBe(RESPONSE_CODE.NG);
  });
});
