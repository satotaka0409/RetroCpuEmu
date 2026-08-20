/**
 * command_cpu_to_io.ts テスト（I/O ボード側ディスパッチャ）
 *
 * フレーム構築は CPU ボードのアセンブラが行う。ここでは
 * HandShake.mdc の位置表に合わせた生バイト列を dispatch する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BREAK_HISTORY_ENTRY_SIZE_TMS9995,
  CPU_FRAME_SIZE,
  CPU_PAYLOAD_REMAINING_SIZE,
  cpuToIoRemainingSize,
  CpuToIoCommandDispatcher,
  type CpuToIoHandlers,
} from "../../../src/ioboard/handshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../../src/shared/handshake/handshake_type";

/**
 * モックハンドラを生成する。
 * @returns vi.fn で埋めた CpuToIoHandlers
 */
function makeMockHandlers(): CpuToIoHandlers {
  return {
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
    getTime: vi.fn().mockReturnValue({
      timestamp: new Uint8Array(8),
      status: RESPONSE_CODE.OK,
    }),
    onBreakNotify: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onStepNotify: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onUndefNotify: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onLcdControl: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    onLcdText: vi.fn().mockReturnValue(RESPONSE_CODE.OK),
    getRtcRaw: vi.fn().mockReturnValue({
      regs: new Uint8Array([0x45, 0x59, 0x23, 0x31, 0x00, 0x12, 0x24]),
      status: RESPONSE_CODE.OK,
    }),
    getTempRaw: vi.fn().mockReturnValue({
      raw: 0x0190,
      status: RESPONSE_CODE.OK,
    }),
    getLightRaw: vi.fn().mockReturnValue({
      clear: 0x1234,
      red: 0x2345,
      green: 0x3456,
      blue: 0x4567,
      status: RESPONSE_CODE.OK,
    }),
    getDistanceRaw: vi.fn().mockReturnValue({
      distanceMm: 0x007b,
      rangeStatus: 0x09,
      status: RESPONSE_CODE.OK,
    }),
  };
}

describe("CPU_FRAME_SIZE", () => {
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
  it("BEEP は 6 バイト（pad 含む）、タイマーは番号込みで 6 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.BEEP]).toBe(6);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIMER_SET]).toBe(6);
  });
  it("時刻取得はコマンドのみ 1 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIME_GET]).toBe(1);
  });
  it("ブレイク通知は 11 バイト、ステップ/未定義通知は 59 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.BREAK_NOTIFY]).toBe(11);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.STEP_NOTIFY]).toBe(59);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.UNDEF_NOTIFY]).toBe(59);
  });
  it("LCD制御は 5 バイト、文字列表示は 20 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.LCD_CTRL]).toBe(5);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.LCD_TEXT]).toBe(20);
  });

  it("センサー系 1Ch〜1Fh はコマンドのみ 1 バイト", () => {
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.RTC_GET_RAW]).toBe(1);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.TEMP_GET_RAW]).toBe(1);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.LIGHT_GET_RAW]).toBe(1);
    expect(CPU_FRAME_SIZE[CMD_CPU_TO_IO.DISTANCE_GET_RAW]).toBe(1);
  });
});

describe("CPU_PAYLOAD_REMAINING_SIZE", () => {
  it("各コマンドの残余サイズは (フレームサイズ - 1) と一致する", () => {
    for (const cmd of Object.keys(CPU_FRAME_SIZE).map(Number)) {
      expect(CPU_PAYLOAD_REMAINING_SIZE[cmd]).toBe(CPU_FRAME_SIZE[cmd] - 1);
    }
  });
});

describe("CpuToIoCommandDispatcher — モード設定(0x10)", () => {
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

describe("CpuToIoCommandDispatcher — BEEP音(0x19)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("onBeep が呼ばれ OK を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x01, 0xb8, 0x01, 0xf4, 0x00]),
    );
    expect(handlers.onBeep).toHaveBeenCalledOnce();
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("onBeep に渡される周波数・長さが正確", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x12, 0x34, 0xab, 0xcd, 0x00]),
    );
    const received = vi.mocked(handlers.onBeep).mock.calls[0][0];
    expect(received.frequencyHz).toBe(0x1234);
    expect(received.durationMs).toBe(0xabcd);
  });

  it("frequencyHz=0 は停止指示として正しく渡される", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BEEP, 0x00, 0x00, 0x00, 0x00, 0x00]),
    );
    const received = vi.mocked(handlers.onBeep).mock.calls[0][0];
    expect(received.frequencyHz).toBe(0);
  });
});

describe("CpuToIoCommandDispatcher — タイマー設定(0x12)", () => {
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

  it("タイマー番号 1 は NG（ハンドラは呼ばない）", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x01, 0x12, 0x34, 0xab, 0xcd]),
    );
    expect(response[0]).toBe(RESPONSE_CODE.NG);
    expect(handlers.onTimerSet).not.toHaveBeenCalled();
  });

  it("count=0 は無限繰り返しとして正しく渡される", () => {
    dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x00, 0x00, 0x64, 0x00, 0x00]),
    );
    const received = vi.mocked(handlers.onTimerSet).mock.calls[0][0];
    expect(received.count).toBe(0);
  });

  it("タイマー番号が 0 以外なら NG（ハンドラは呼ばない）", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIMER_SET, 0x02, 0x00, 0x64, 0x00, 0x00]),
    );
    expect(response[0]).toBe(RESPONSE_CODE.NG);
    expect(handlers.onTimerSet).not.toHaveBeenCalled();
  });
});

describe("CpuToIoCommandDispatcher — 時刻取得(0x11)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("getTime が呼ばれ 9バイト(時刻8 + ステータス)を返す", () => {
    const ts = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
    vi.mocked(handlers.getTime).mockReturnValue({
      timestamp: ts,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TIME_GET]),
    );
    expect(handlers.getTime).toHaveBeenCalledOnce();
    expect(response.length).toBe(9);
    expect([...response.slice(0, 8)]).toEqual([...ts]);
    expect(response[8]).toBe(RESPONSE_CODE.OK);
  });
});

describe("CpuToIoCommandDispatcher — ブレイク通知(0x1A)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("1Ah ヘッダ（件数0）を onBreakNotify へ渡し OK を返す", () => {
    const frame = new Uint8Array([
      CMD_CPU_TO_IO.BREAK_NOTIFY,
      3,
      0,
      0xc2,
      9,
      0x00,
      0x00,
      0x30,
      0x00,
      0,
      0,
    ]);
    const response = dispatcher.dispatch(frame);
    expect(handlers.onBreakNotify).toHaveBeenCalledWith({
      kind: 0,
      slot: 3,
      flags: 0xc2,
      breakCount: 9,
      historyCount: 0,
      historyEntries: [],
      addr: 0x00003000,
    });
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("履歴エントリを件数分そのまま通知できる", () => {
    const count = 2;
    const entries = new Uint8Array(count * 66);
    entries[0] = 0xaa;
    entries[65] = 0xbb;
    entries[66] = 0xcc;
    entries[131] = 0xdd;

    const frame = new Uint8Array(11 + entries.length);
    frame.set(
      [
        CMD_CPU_TO_IO.BREAK_NOTIFY,
        3,
        count,
        0x82,
        0,
        0x00,
        0x00,
        0x40,
        0x00,
        count,
        0,
      ],
      0,
    );
    frame.set(entries, 11);

    const response = dispatcher.dispatch(frame);
    expect(handlers.onBreakNotify).toHaveBeenCalledWith({
      kind: 1,
      slot: 3,
      flags: 0x82,
      breakCount: 0,
      historyCount: count,
      historyEntries: [entries.slice(0, 66), entries.slice(66, 132)],
      addr: 0x00004000,
    });
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("TMS9995 は履歴エントリ 78B で切り出す", () => {
    const tms = new CpuToIoCommandDispatcher(handlers, {
      historyEntrySize: 78,
    });
    const count = 1;
    const entries = new Uint8Array(78);
    entries[0] = 0x11;
    entries[77] = 0x22;
    const frame = new Uint8Array(11 + entries.length);
    frame.set(
      [
        CMD_CPU_TO_IO.BREAK_NOTIFY,
        0,
        count,
        0x82,
        0,
        0x00,
        0x00,
        0x10,
        0x00,
        count,
        0,
      ],
      0,
    );
    frame.set(entries, 11);
    tms.dispatch(frame);
    expect(handlers.onBreakNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        historyCount: 1,
        historyEntries: [entries],
      }),
    );
  });

  it("historyCount=4（満杯）をそのまま通知できる", () => {
    const count = 4;
    const entries = new Uint8Array(count * 66);
    const frame = new Uint8Array(11 + entries.length);
    frame.set(
      [
        CMD_CPU_TO_IO.BREAK_NOTIFY,
        2,
        count,
        0xc2,
        3,
        0x00,
        0x00,
        0x30,
        0x00,
        0,
        0xff,
      ],
      0,
    );
    frame.set(entries, 11);
    dispatcher.dispatch(frame);
    expect(handlers.onBreakNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        historyCount: 4,
      }),
    );
  });

  it("履歴件数はヘッダ位置(02h)を優先し、末尾の重複値(09h)に影響されない", () => {
    const entries = new Uint8Array(4 * 66);
    const frame = new Uint8Array([
      CMD_CPU_TO_IO.BREAK_NOTIFY,
      2,
      4,
      0xc2,
      3,
      0x00,
      0x00,
      0x30,
      0x00,
      0,
      0xff,
    ]);
    const full = new Uint8Array(11 + entries.length);
    full.set(frame, 0);
    full.set(entries, 11);
    dispatcher.dispatch(full);
    expect(handlers.onBreakNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        historyCount: 4,
      }),
    );
  });

  it("スロット 4 は NG", () => {
    const frame = new Uint8Array([
      CMD_CPU_TO_IO.BREAK_NOTIFY,
      4,
      0,
      0,
      0,
      0x00,
      0x00,
      0x18,
      0x00,
      0,
      0,
    ]);
    const response = dispatcher.dispatch(frame);
    expect(handlers.onBreakNotify).not.toHaveBeenCalled();
    expect(response[0]).toBe(RESPONSE_CODE.NG);
  });

  it("kind は flags から導出する（MEM/IO）", () => {
    dispatcher.dispatch(
      new Uint8Array([
        CMD_CPU_TO_IO.BREAK_NOTIFY,
        0,
        0,
        0x00,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
    );
    expect(handlers.onBreakNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 1, historyCount: 0 }),
    );

    dispatcher.dispatch(
      new Uint8Array([
        CMD_CPU_TO_IO.BREAK_NOTIFY,
        1,
        0,
        0x01,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
    );
    expect(handlers.onBreakNotify).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 2, historyCount: 0 }),
    );
  });

  it("フレーム不足は NG", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.BREAK_NOTIFY, 0, 0, 0, 0]),
    );
    expect(handlers.onBreakNotify).not.toHaveBeenCalled();
    expect(response[0]).toBe(RESPONSE_CODE.NG);
  });

  it("履歴件数に対してエントリ不足でもヘッダ情報は通知できる（後方互換）", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([
        CMD_CPU_TO_IO.BREAK_NOTIFY,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
      ]),
    );
    expect(handlers.onBreakNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        historyCount: 1,
        historyEntries: [],
      }),
    );
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });
});

describe("CpuToIoCommandDispatcher — ステップ通知(0x1B)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("1Bh を onStepNotify へ渡し OK を返す", () => {
    const frame = new Uint8Array(59);
    frame[0] = CMD_CPU_TO_IO.STEP_NOTIFY;
    frame[3] = 0x18;
    frame[4] = 0x00;
    frame[5] = 0x11;
    frame[6] = 0x11;
    frame[0x0f] = 0xff;
    frame[0x10] = 0x00;
    frame[0x13] = 0x18;
    frame[0x14] = 0x00;
    frame[0x19] = 0x0a;
    frame[0x1b] = 0xaa;
    frame[0x1c] = 0xbb;
    const response = dispatcher.dispatch(frame);
    expect(handlers.onStepNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        addr: 0x00001800,
        r0: 0x1111,
        sp: 0xff00,
        ic: 0x1800,
        npp: 0x0a,
      }),
    );
    const arg = (handlers.onStepNotify as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { stack: number[] };
    expect(arg.stack).toHaveLength(16);
    expect(arg.stack[0]).toBe(0xaabb);
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });
});

describe("CpuToIoCommandDispatcher — 未定義命令通知(0x13)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("13h を onUndefNotify へ渡し OK を返す", () => {
    const frame = new Uint8Array(59);
    frame[0] = CMD_CPU_TO_IO.UNDEF_NOTIFY;
    frame[3] = 0x18;
    frame[4] = 0x02;
    frame[5] = 0x22;
    frame[6] = 0x22;
    frame[0x13] = 0x18;
    frame[0x14] = 0x02;
    frame[0x19] = 0x05;
    frame[0x1b] = 0xde;
    frame[0x1c] = 0xad;
    const response = dispatcher.dispatch(frame);
    expect(handlers.onUndefNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        addr: 0x00001802,
        r0: 0x2222,
        ic: 0x1802,
        npp: 0x05,
      }),
    );
    const arg = (handlers.onUndefNotify as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as { stack: number[] };
    expect(arg.stack[0]).toBe(0xdead);
    expect(arg.stack).toHaveLength(16);
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });
});

describe("CpuToIoCommandDispatcher — LCD(0x17/0x18)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("17h を onLcdControl へ渡し OK を返す", () => {
    const frame = new Uint8Array([CMD_CPU_TO_IO.LCD_CTRL, 0, 0, 0, 0]);
    const response = dispatcher.dispatch(frame);
    expect(handlers.onLcdControl).toHaveBeenCalledWith(frame);
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("18h を onLcdText へ渡し OK を返す", () => {
    const frame = new Uint8Array(20);
    frame[0] = CMD_CPU_TO_IO.LCD_TEXT;
    const response = dispatcher.dispatch(frame);
    expect(handlers.onLcdText).toHaveBeenCalledWith(frame);
    expect(response[0]).toBe(RESPONSE_CODE.OK);
  });

  it("17h のフレーム不足は NG でハンドラを呼ばない", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.LCD_CTRL, 0, 0]),
    );
    expect(handlers.onLcdControl).not.toHaveBeenCalled();
    expect(response[0]).toBe(RESPONSE_CODE.NG);
  });
});

describe("CpuToIoCommandDispatcher — センサー生値(0x1C-0x1F)", () => {
  let handlers: CpuToIoHandlers;
  let dispatcher: CpuToIoCommandDispatcher;

  beforeEach(() => {
    handlers = makeMockHandlers();
    dispatcher = new CpuToIoCommandDispatcher(handlers);
  });

  it("1Ch: RTC 生レジスタ 7 バイト + status を返す", () => {
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.RTC_GET_RAW]),
    );
    expect(handlers.getRtcRaw).toHaveBeenCalledOnce();
    expect(response).toEqual(
      new Uint8Array([0x45, 0x59, 0x23, 0x31, 0x00, 0x12, 0x24, 0x00]),
    );
  });

  it("1Dh: 温度生値 raw16(BE) + status を返す", () => {
    vi.mocked(handlers.getTempRaw).mockReturnValue({
      raw: 0x1f90,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.TEMP_GET_RAW]),
    );
    expect(handlers.getTempRaw).toHaveBeenCalledOnce();
    expect(response).toEqual(new Uint8Array([0x1f, 0x90, 0x00]));
  });

  it("1Eh: RGBC 生値 (各16bit BE) + status を返す", () => {
    vi.mocked(handlers.getLightRaw).mockReturnValue({
      clear: 0xabcd,
      red: 0x0123,
      green: 0x4567,
      blue: 0x89ef,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.LIGHT_GET_RAW]),
    );
    expect(handlers.getLightRaw).toHaveBeenCalledOnce();
    expect(response).toEqual(
      new Uint8Array([0xab, 0xcd, 0x01, 0x23, 0x45, 0x67, 0x89, 0xef, 0x00]),
    );
  });

  it("1Fh: 距離 raw16(BE) + rangeStatus(下位5bit) + status", () => {
    vi.mocked(handlers.getDistanceRaw).mockReturnValue({
      distanceMm: 0x0102,
      rangeStatus: 0xff,
      status: RESPONSE_CODE.OK,
    });
    const response = dispatcher.dispatch(
      new Uint8Array([CMD_CPU_TO_IO.DISTANCE_GET_RAW]),
    );
    expect(handlers.getDistanceRaw).toHaveBeenCalledOnce();
    expect(response).toEqual(new Uint8Array([0x01, 0x02, 0x1f, 0x00]));
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

describe("cpuToIoRemainingSize — 1Ah 可変長", () => {
  it("MN1613 は件数×66 を残余に加算する", () => {
    const hdr = new Uint8Array([0x1a, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(cpuToIoRemainingSize(hdr.slice(0, 3))).toBe(11 - 3 + 2 * 66);
    expect(cpuToIoRemainingSize(hdr, 66)).toBe(2 * 66);
  });

  it("TMS9995 は件数×78 を残余に加算する", () => {
    const hdr = new Uint8Array([0x1a, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(cpuToIoRemainingSize(hdr, BREAK_HISTORY_ENTRY_SIZE_TMS9995)).toBe(
      78,
    );
  });
});
