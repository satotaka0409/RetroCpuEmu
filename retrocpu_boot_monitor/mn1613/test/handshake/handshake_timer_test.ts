/**
 * gl_bios_timer_set（CPU→IO コマンド 19h）
 * 根拠: HandShake.mdc / boot_monitor.mdc / test_framework.mdc
 */
import {
  attachHandshakeMock,
  createSessionFromSettings,
  expect,
  test,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import { mn1613MonSettings } from "../mn1613_mon_settings.js";

const BASE_REGS = {
  R2: 0x2222,
  R3: 0x3333,
  R4: 0x4444,
} as const;

const session: Mn1613AsmSession = createSessionFromSettings(mn1613MonSettings);

/**
 * gl_main 済み＋モック付きで 1 ケースを実行する。
 * @param fn 本体（session / mock 利用可）
 */
async function withCase(
  fn: (s: Mn1613AsmSession, mock: IoBoardHandshakeMock) => Promise<void>,
): Promise<void> {
  session.reload();
  const mock = attachHandshakeMock({ syncIrq2: false, timeoutMs: 5000 });
  try {
    await session.runInit();
    await fn(session, mock);
  } finally {
    await mock.stop();
    mock.detach();
  }
}

/**
 * gl_bios_timer_set を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param timerNo タイマー番号（R0）
 * @param periodMs 周期 ms（R1）
 * @param count 回数（第3引数・スタック）
 */
async function callTimerSet(
  mock: IoBoardHandshakeMock,
  timerNo: number,
  periodMs: number,
  count: number,
): Promise<void> {
  await Promise.all([
    session.call("gl_bios_timer_set", {
      registers: { ...BASE_REGS, R0: timerNo, R1: periodMs },
      stack: [count],
    }),
    mock.handleOneRequest(),
  ]);
}

test("番号 1・周期 100ms・回数 3 がそのまま IO ボードへ届く", async () => {
  await withCase(async (s, mock) => {
    await callTimerSet(mock, 1, 100, 3);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.lastTimer).toEqual({
      timerNo: 1,
      periodMs: 100,
      count: 3,
    });
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(true);
    expect(mock.timers[1].getState().periodMs).toBe(100);
    expect(mock.timers[1].getState().count).toBe(3);
  });
});

test("番号 0 は 16bit 周期をそのまま送る", async () => {
  await withCase(async (s, mock) => {
    await callTimerSet(mock, 0, 0x1234, 0);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.lastTimer).toEqual({
      timerNo: 0,
      periodMs: 0x1234,
      count: 0,
    });
    expect(mock.timers[0].running).toBe(true);
    expect(mock.timers[1].running).toBe(false);
  });
});

test("番号が 0/1 以外なら IO ボードが NG を返しタイマーは動かない", async () => {
  await withCase(async (s, mock) => {
    await callTimerSet(mock, 2, 100, 0);
    s.expectRegisters({ R0: 1 });
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(false);
  });
});

test("R2/R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callTimerSet(mock, 1, 100, 3);
    s.expectRegisters({
      R0: 0,
      R2: 0x2222,
      R3: 0x3333,
      R4: 0x4444,
    });
    s.expectStackWork({ from: "preCallSp", offset: 2, words: [3] });
  });
});
