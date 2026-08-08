/**
 * gl_bios_timer_set ↔ IO モック（ハンドシェイク 19h）
 * 根拠: HandShake.mdc「タイマー設定」/ boot_monitor.mdc / test_framework.mdc
 *
 * Intel HEX / CDB / initLabel はテストコードに書く。gl_main で HALT してから call する。
 */
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RESPONSE_CODE } from "@emu/main/feature/cpu/mn1613/handhshake/handshake_type";
import {
  FRAMEWORK_BUILD,
  MONITOR_SRC,
  assembleToHexCdb,
  attachHandshakeMock,
  createMn1613AsmSession,
  type AsmSource,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../src/index.js";

const HEX_FILE = path.join(FRAMEWORK_BUILD, "bios_timer.ihx");
const CDB_FILE = path.join(FRAMEWORK_BUILD, "bios_timer.cdb");
const INIT_LABEL = "gl_main";

const src = (...p: string[]) => path.join(MONITOR_SRC, ...p);

const SOURCES: AsmSource[] = [
  { file: src("main.asm"), module: "MAIN" },
  { file: src("interrupt.asm") },
  { file: src("handshake/handshake_common.asm") },
  { file: src("handshake/handshake_main.asm") },
  { file: src("handshake/handshake_timer.asm") },
  { file: src("bios/bios_common.asm") },
];

describe("gl_bios_timer_set (19h)", () => {
  let session: Mn1613AsmSession;
  let mock: IoBoardHandshakeMock;

  beforeAll(() => {
    assembleToHexCdb({
      sources: SOURCES,
      hexFile: HEX_FILE,
      cdbFile: CDB_FILE,
    });
  });

  beforeEach(async () => {
    session = createMn1613AsmSession({
      hexFile: HEX_FILE,
      cdbFile: CDB_FILE,
      initLabel: INIT_LABEL,
    });
    mock = attachHandshakeMock({ syncIrq2: false });
    await session.runInit();
  });

  afterEach(async () => {
    await mock.stop();
    mock.detach();
  });

  /**
   * gl_bios_timer_set を 1 回呼ぶ（gl_main 済みなので RNG 初期化済み）。
   * @param timerNo タイマー番号
   * @param periodMs 周期 ms
   * @param count 回数
   * @returns call 結果
   */
  async function callTimerSet(timerNo: number, periodMs: number, count: number) {
    const io = mock.handleOneRequest();
    const [r] = await Promise.all([
      session.call("gl_bios_timer_set", {
        registers: {
          R0: timerNo,
          R1: periodMs,
          R2: 0x2222,
          R3: 0x3333,
          R4: 0x4444,
        },
        stack: [count],
      }),
      io,
    ]);
    return r;
  }

  it("gl_main 後は SP がスタック先頭", () => {
    session.expectRegisters({ SP: 0xffff });
  });

  it(
    "番号 1・周期 100ms・回数 3 がそのまま IO ボードへ届く",
    async () => {
      await callTimerSet(1, 100, 3);
      session.expectRegisters({ R0: RESPONSE_CODE.OK });
      expect(mock.state.lastTimer).toEqual({
        timerNo: 1,
        periodMs: 100,
        count: 3,
      });
      expect(mock.timers[0].running).toBe(false);
      expect(mock.timers[1].getState()).toMatchObject({
        running: true,
        periodMs: 100,
        count: 3,
      });
    },
    20000,
  );

  it(
    "番号 0 は 16bit 周期をそのまま送る",
    async () => {
      await callTimerSet(0, 0x1234, 0);
      session.expectRegisters({ R0: RESPONSE_CODE.OK });
      expect(mock.state.lastTimer).toEqual({
        timerNo: 0,
        periodMs: 0x1234,
        count: 0,
      });
      expect(mock.timers[0].running).toBe(true);
      expect(mock.timers[1].running).toBe(false);
    },
    20000,
  );

  it(
    "番号が 0/1 以外なら IO ボードが NG を返しタイマーは動かない",
    async () => {
      await callTimerSet(2, 100, 0);
      session.expectRegisters({ R0: RESPONSE_CODE.NG });
      expect(mock.timers[0].running).toBe(false);
      expect(mock.timers[1].running).toBe(false);
    },
    20000,
  );

  it(
    "R2/R3/R4 は呼び出しの前後で保たれる",
    async () => {
      await callTimerSet(1, 100, 3);
      session.expectRegisters({
        R0: RESPONSE_CODE.OK,
        R2: 0x2222,
        R3: 0x3333,
        R4: 0x4444,
      });
      session.expectStackWork({ from: "preCallSp", offset: 2, words: [3] });
    },
    20000,
  );
});
