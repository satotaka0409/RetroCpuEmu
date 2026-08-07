/**
 * command_cpu_to_io.ts テスト
 *
 * テスト対象:
 *   - build~Frame()       CPUボード側フレーム構築関数
 *   - CPU_FRAME_SIZE      コマンドごとのフレームサイズ定数
 *   - CPU_PAYLOAD_REMAINING_SIZE  コマンドバイト受信後の追加受信サイズ
 *   - CpuToIoCommandDispatcher    I/Oボード側コマンドディスパッチャ
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildBeepFrame,
  buildCpuStatusFrame,
  buildHexKeyGetFrame,
  buildLedDisplayFrame,
  buildModeSetFrame,
  buildPcKeyGetFrame,
  buildTimerSetFrame,
  CPU_FRAME_SIZE,
  CPU_PAYLOAD_REMAINING_SIZE,
  CpuToIoCommandDispatcher,
  type BeepParams,
  type CpuRegisters,
  type CpuToIoHandlers,
  type LedDisplayData,
  type TimerParams,
  reg16,
  reg24,
} from "../../../../../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_type";

// ─────────────────────────────────────────────
// テスト用フィクスチャ
// ─────────────────────────────────────────────

/** テスト用CPUレジスタ値（各フィールドを一意な値にして位置ミスを検出する） */
const SAMPLE_REGS: CpuRegisters = {
  R0: reg16(0x1234),
  R1: reg16(0x2345),
  R2: reg16(0x3456),
  R3: reg16(0x4567),
  R4: reg16(0x5678),
  SP: reg24(0xabcdef), // 24-bit
  STR: reg24(0x123456), // 24-bit
  IC: reg16(0x789a),
  CSBR: reg16(0xbcde),
  SSBR: reg16(0xdef0),
  TSR0: reg16(0x1122),
  TSR1: reg16(0x3344),
  OSR0: reg16(0x5566),
  OSR1: reg16(0x77), // 8-bit
  OSR2: reg24(0x889900), // 24-bit
  NPP: reg16(0xaa), // 8-bit (H byte)
  IISR: reg16(0xbb), // 8-bit (L byte)
  SBRB: reg16(0xcc), // 8-bit (L byte)
  ICB: reg16(0xddee),
};

/** モックハンドラを生成する */
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

// ─────────────────────────────────────────────
// CPU_FRAME_SIZE / CPU_PAYLOAD_REMAINING_SIZE
// ─────────────────────────────────────────────

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
  it("BEEP・タイマーは 5 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.BEEP]).toBe(5);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIMER_SET]).toBe(5);
  });
});

describe("CPU_PAYLOAD_REMAINING_SIZE", () => {
  it("各コマンドの残余サイズは (フレームサイズ - 1) と一致する", () => {
    for (const cmd of Object.keys(CPU_FRAME_SIZE).map(Number)) {
      expect(CPU_PAYLOAD_REMAINING_SIZE[cmd]).toBe(CPU_FRAME_SIZE[cmd] - 1);
    }
  });
});

// ─────────────────────────────────────────────
// buildCpuStatusFrame
// ─────────────────────────────────────────────

describe("buildCpuStatusFrame", () => {
  let frame: Uint8Array;

  beforeEach(() => {
    frame = buildCpuStatusFrame(SAMPLE_REGS);
  });

  it("フレームサイズが 0x29 バイト", () => {
    expect(frame.length).toBe(0x29);
  });

  it("先頭バイトがコマンド 0x10", () => {
    expect(frame[0x00]).toBe(CMD_CPU_TO_IO.CPU_STATUS_NOTIFY);
  });

  it("R0 が正しい位置(0x01-0x02)に格納される", () => {
    expect(frame[0x01]).toBe(0x12);
    expect(frame[0x02]).toBe(0x34);
  });

  it("R1〜R4 が連続する正しい位置に格納される", () => {
    // R1: 0x03-0x04
    expect(frame[0x03]).toBe(0x23);
    expect(frame[0x04]).toBe(0x45);
    // R4: 0x09-0x0A
    expect(frame[0x09]).toBe(0x56);
    expect(frame[0x0a]).toBe(0x78);
  });

  it("SP が 24-bit で 0x0B-0x0D に格納される", () => {
    expect(frame[0x0b]).toBe(0xab);
    expect(frame[0x0c]).toBe(0xcd);
    expect(frame[0x0d]).toBe(0xef);
  });

  it("STR が 24-bit で 0x0E-0x10 に格納される", () => {
    expect(frame[0x0e]).toBe(0x12);
    expect(frame[0x0f]).toBe(0x34);
    expect(frame[0x10]).toBe(0x56);
  });

  it("OSR1 が 8-bit で 0x1D に格納される", () => {
    expect(frame[0x1d]).toBe(0x77);
  });

  it("OSR2 が 24-bit で 0x1E-0x20 に格納される", () => {
    expect(frame[0x1e]).toBe(0x88);
    expect(frame[0x1f]).toBe(0x99);
    expect(frame[0x20]).toBe(0x00);
  });

  it("NPP が上位バイト(0x21)に、下位バイト(0x22)は 0x00", () => {
    expect(frame[0x21]).toBe(0xaa);
    expect(frame[0x22]).toBe(0x00);
  });

  it("IISR が下位バイト(0x24)に、上位バイト(0x23)は 0x00", () => {
    expect(frame[0x23]).toBe(0x00);
    expect(frame[0x24]).toBe(0xbb);
  });

  it("SBRB が下位バイト(0x26)に、上位バイト(0x25)は 0x00", () => {
    expect(frame[0x25]).toBe(0x00);
    expect(frame[0x26]).toBe(0xcc);
  });

  it("ICB が 0x27-0x28 に格納される", () => {
    expect(frame[0x27]).toBe(0xdd);
    expect(frame[0x28]).toBe(0xee);
  });
});

// ─────────────────────────────────────────────
// buildModeSetFrame
// ─────────────────────────────────────────────

describe("buildModeSetFrame", () => {
  it("モニターモード(0)のフレームを構築できる", () => {
    const frame = buildModeSetFrame(MODE.MONITOR);
    expect(frame.length).toBe(2);
    expect(frame[0]).toBe(CMD_CPU_TO_IO.MODE_SET);
    expect(frame[1]).toBe(MODE.MONITOR);
  });

  it("フリーモード(1)のフレームを構築できる", () => {
    const frame = buildModeSetFrame(MODE.FREE);
    expect(frame[1]).toBe(MODE.FREE);
  });
});

// ─────────────────────────────────────────────
// buildHexKeyGetFrame / buildPcKeyGetFrame
// ─────────────────────────────────────────────

describe("buildHexKeyGetFrame / buildPcKeyGetFrame", () => {
  it("HexKeyGet は 1バイト(コマンドのみ)", () => {
    const frame = buildHexKeyGetFrame();
    expect(frame.length).toBe(1);
    expect(frame[0]).toBe(CMD_CPU_TO_IO.HEX_KEY_GET);
  });

  it("PcKeyGet は 1バイト(コマンドのみ)", () => {
    const frame = buildPcKeyGetFrame();
    expect(frame.length).toBe(1);
    expect(frame[0]).toBe(CMD_CPU_TO_IO.PC_KEY_GET);
  });
});

// ─────────────────────────────────────────────
// buildLedDisplayFrame
// ─────────────────────────────────────────────

describe("buildLedDisplayFrame", () => {
  const sevenSeg = new Uint8Array([
    0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c,
  ]);

  it("15バイトのフレームを構築できる", () => {
    const frame = buildLedDisplayFrame({
      sevenSeg,
      bulletLed0_7: 0xab,
      bulletLed8_F: 0xcd,
    });
    expect(frame.length).toBe(15);
    expect(frame[0]).toBe(CMD_CPU_TO_IO.LED_DISPLAY);
  });

  it("7セグデータが 0x01〜0x0C に格納される", () => {
    const frame = buildLedDisplayFrame({
      sevenSeg,
      bulletLed0_7: 0,
      bulletLed8_F: 0,
    });
    expect(Array.from(frame.slice(0x01, 0x0d))).toEqual(Array.from(sevenSeg));
  });

  it("砲弾LED が 0x0D, 0x0E に格納される", () => {
    const frame = buildLedDisplayFrame({
      sevenSeg,
      bulletLed0_7: 0xab,
      bulletLed8_F: 0xcd,
    });
    expect(frame[0x0d]).toBe(0xab);
    expect(frame[0x0e]).toBe(0xcd);
  });

  it("sevenSeg が 12バイト以外の場合 RangeError をスロー", () => {
    const bad: LedDisplayData = {
      sevenSeg: new Uint8Array(10),
      bulletLed0_7: 0,
      bulletLed8_F: 0,
    };
    expect(() => buildLedDisplayFrame(bad)).toThrow(RangeError);
  });
});

// ─────────────────────────────────────────────
// buildBeepFrame
// ─────────────────────────────────────────────

describe("buildBeepFrame", () => {
  it("5バイトのフレームを構築できる", () => {
    const frame = buildBeepFrame({ frequencyHz: 440, durationMs: 500 });
    expect(frame.length).toBe(5);
    expect(frame[0]).toBe(CMD_CPU_TO_IO.BEEP);
  });

  it("周波数が 0x01-0x02 に Big-Endian で格納される", () => {
    const frame = buildBeepFrame({ frequencyHz: 0x1234, durationMs: 0 });
    expect(frame[0x01]).toBe(0x12);
    expect(frame[0x02]).toBe(0x34);
  });

  it("長さが 0x03-0x04 に Big-Endian で格納される", () => {
    const frame = buildBeepFrame({ frequencyHz: 0, durationMs: 0xabcd });
    expect(frame[0x03]).toBe(0xab);
    expect(frame[0x04]).toBe(0xcd);
  });

  it("frequencyHz=0 で停止フレームを構築できる", () => {
    const frame = buildBeepFrame({ frequencyHz: 0, durationMs: 0 });
    expect(frame[0x01]).toBe(0x00);
    expect(frame[0x02]).toBe(0x00);
  });
});

// ─────────────────────────────────────────────
// buildTimerSetFrame
// ─────────────────────────────────────────────

describe("buildTimerSetFrame", () => {
  it("5バイトのフレームを構築できる", () => {
    const frame = buildTimerSetFrame({ periodMs: 100, count: 10 });
    expect(frame.length).toBe(5);
    expect(frame[0]).toBe(CMD_CPU_TO_IO.TIMER_SET);
  });

  it("周期が 0x01-0x02 に格納される", () => {
    const frame = buildTimerSetFrame({ periodMs: 0x0064, count: 0 });
    expect(frame[0x01]).toBe(0x00);
    expect(frame[0x02]).toBe(0x64);
  });

  it("回数が 0x03-0x04 に格納される", () => {
    const frame = buildTimerSetFrame({ periodMs: 0, count: 0x000a });
    expect(frame[0x03]).toBe(0x00);
    expect(frame[0x04]).toBe(0x0a);
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — CPU状態通知 (0x10)
// ─────────────────────────────────────────────

describe("CpuToIoCommandDispatcher — CPU状態通知(0x10)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onCpuStatusNotify が呼ばれ OK を返す", () => {
    const frame = buildCpuStatusFrame(SAMPLE_REGS);
    const response = dispatcher.dispatch(frame);
    expect(handlers.onCpuStatusNotify).toHaveBeenCalledOnce();
    expect(response).toEqual(new Uint8Array([RESPONSE_CODE.OK]));
  });

  it("onCpuStatusNotify に渡されるレジスタ値が正確", () => {
    const frame = buildCpuStatusFrame(SAMPLE_REGS);
    dispatcher.dispatch(frame);
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
    const response = dispatcher.dispatch(buildCpuStatusFrame(SAMPLE_REGS));
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

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — モード設定 (0x11)
// ─────────────────────────────────────────────

describe("CpuToIoCommandDispatcher — モード設定(0x11)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("モニターモード(0)で onModeSet(0) が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(buildModeSetFrame(MODE.MONITOR));
    expect(handlers.onModeSet).toHaveBeenCalledWith(MODE.MONITOR);
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("フリーモード(1)で onModeSet(1) が呼ばれる", () => {
    dispatcher.dispatch(buildModeSetFrame(MODE.FREE));
    expect(handlers.onModeSet).toHaveBeenCalledWith(MODE.FREE);
  });

  it("無効なモード値(2)を送ると NG を返し onModeSet は呼ばれない", () => {
    const invalidFrame = new Uint8Array([CMD_CPU_TO_IO.MODE_SET, 2]);
    const response = dispatcher.dispatch(invalidFrame);
    expect(response[0]).toBe(RESPONSE_CODE.NG);
    expect(handlers.onModeSet).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — 16進キー入力取得 (0x14)
// ─────────────────────────────────────────────

describe("CpuToIoCommandDispatcher — 16進キー入力取得(0x14)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("getHexKeys が呼ばれ 9バイト(列0〜7 + ステータス)を返す", () => {
    const response = dispatcher.dispatch(buildHexKeyGetFrame());
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
    const response = dispatcher.dispatch(buildHexKeyGetFrame());
    expect(Array.from(response.slice(0, 8))).toEqual(Array.from(columns));
  });

  it("モードエラーの場合 NG(0x01) を返す", () => {
    vi.mocked(handlers.getHexKeys).mockReturnValue({
      columns: new Uint8Array(8),
      status: RESPONSE_CODE.NG_MODE_ERROR,
    });
    const response = dispatcher.dispatch(buildHexKeyGetFrame());
    expect(response[8]).toBe(RESPONSE_CODE.NG_MODE_ERROR);
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — PCキー入力取得 (0x15)
// ─────────────────────────────────────────────

describe("CpuToIoCommandDispatcher — PCキー入力取得(0x15)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("getPcKey が呼ばれ 3バイト(ASCII + キーコード + ステータス)を返す", () => {
    const response = dispatcher.dispatch(buildPcKeyGetFrame());
    expect(handlers.getPcKey).toHaveBeenCalledOnce();
    expect(response.length).toBe(3);
  });

  it("ASCII値・キーコード・ステータスが正しく格納される", () => {
    vi.mocked(handlers.getPcKey).mockReturnValue({
      ascii: 0x41,
      keyCode: 0x26,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(buildPcKeyGetFrame());
    expect(response[0]).toBe(0x41); // ASCII
    expect(response[1]).toBe(0x26); // keyCode
    expect(response[2]).toBe(RESPONSE_CODE.OK);
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — LED表示依頼 (0x16)
// ─────────────────────────────────────────────

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

  it("onLedDisplay が呼ばれ OK を返す", () => {
    const frame = buildLedDisplayFrame({
      sevenSeg,
      bulletLed0_7: 0xff,
      bulletLed8_F: 0x00,
    });
    const response = dispatcher.dispatch(frame);
    expect(handlers.onLedDisplay).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onLedDisplay に渡される sevenSeg・bulletLed が正確", () => {
    const frame = buildLedDisplayFrame({
      sevenSeg,
      bulletLed0_7: 0xab,
      bulletLed8_F: 0xcd,
    });
    dispatcher.dispatch(frame);
    const received = vi.mocked(handlers.onLedDisplay).mock.calls[0][0];
    expect(Array.from(received.sevenSeg)).toEqual(Array.from(sevenSeg));
    expect(received.bulletLed0_7).toBe(0xab);
    expect(received.bulletLed8_F).toBe(0xcd);
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — BEEP音 (0x18)
// ─────────────────────────────────────────────

describe("CpuToIoCommandDispatcher — BEEP音(0x18)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onBeep が呼ばれ OK を返す", () => {
    const params: BeepParams = { frequencyHz: 440, durationMs: 500 };
    const response = dispatcher.dispatch(buildBeepFrame(params));
    expect(handlers.onBeep).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onBeep に渡される周波数・長さが正確", () => {
    const params: BeepParams = { frequencyHz: 0x1234, durationMs: 0xabcd };
    dispatcher.dispatch(buildBeepFrame(params));
    const received = vi.mocked(handlers.onBeep).mock.calls[0][0];
    expect(received.frequencyHz).toBe(0x1234);
    expect(received.durationMs).toBe(0xabcd);
  });

  it("frequencyHz=0 は停止指示として正しく渡される", () => {
    dispatcher.dispatch(buildBeepFrame({ frequencyHz: 0, durationMs: 0 }));
    const received = vi.mocked(handlers.onBeep).mock.calls[0][0];
    expect(received.frequencyHz).toBe(0);
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — タイマー設定 (0x19)
// ─────────────────────────────────────────────

describe("CpuToIoCommandDispatcher — タイマー設定(0x19)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onTimerSet が呼ばれ OK を返す", () => {
    const params: TimerParams = { periodMs: 100, count: 10 };
    const response = dispatcher.dispatch(buildTimerSetFrame(params));
    expect(handlers.onTimerSet).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onTimerSet に渡される周期・回数が正確", () => {
    const params: TimerParams = { periodMs: 0x1234, count: 0xabcd };
    dispatcher.dispatch(buildTimerSetFrame(params));
    const received = vi.mocked(handlers.onTimerSet).mock.calls[0][0];
    expect(received.periodMs).toBe(0x1234);
    expect(received.count).toBe(0xabcd);
  });

  it("count=0 は無限繰り返しとして正しく渡される", () => {
    dispatcher.dispatch(buildTimerSetFrame({ periodMs: 100, count: 0 }));
    const received = vi.mocked(handlers.onTimerSet).mock.calls[0][0];
    expect(received.count).toBe(0);
  });
});

// ─────────────────────────────────────────────
// CpuToIoCommandDispatcher — エラーケース
// ─────────────────────────────────────────────

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
    const short = new Uint8Array([CMD_CPU_TO_IO.LED_DISPLAY, 0x00]); // 2バイト、必要は15
    expect(dispatcher.dispatch(short)[0]).toBe(RESPONSE_CODE.NG);
  });

  it("フレーム長が不足している場合は NG を返す（BEEP - 4バイト）", () => {
    const short = new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x00, 0x01, 0x00]); // 4バイト、必要は5
    expect(dispatcher.dispatch(short)[0]).toBe(RESPONSE_CODE.NG);
  });
});
