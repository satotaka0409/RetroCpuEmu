/**
 * g_bios_timer_set（CPU→IO コマンド 12h）
 * 根拠: HandShake.mdc / boot_monitor.mdc / test_framework.mdc
 */
import {
  createSessionFromSettings,
  expect,
  test,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import {
  mn1613MonHandshakeSettings,
  withMn1613CpuLog,
} from "../mn1613_mon_settings.js";

const BASE_REGS = {
  R2: 0x2222,
  R3: 0x3333,
  R4: 0x4444,
} as const;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

/**
 * g_main 済み＋ ioMock handshake で 1 ケースを実行する。
 * @param fn 本体（session / mock 利用可）
 */
async function withCase(
  fn: (s: Mn1613AsmSession, mock: IoBoardHandshakeMock) => Promise<void>,
): Promise<void> {
  session.reload();
  try {
    await session.runInit();
    await fn(session, session.requireHandshakeMock());
  } finally {
    await session.detachIoMock();
  }
}

/**
 * g_bios_timer_set を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param timerNo タイマー番号（R0）
 * @param periodMs 周期 ms（R1）
 * @param count 回数（第3引数・R2）
 */
async function callTimerSet(
  mock: IoBoardHandshakeMock,
  timerNo: number,
  periodMs: number,
  count: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_timer_set", {
      registers: { R3: BASE_REGS.R3, R4: BASE_REGS.R4, R0: timerNo, R1: periodMs, R2: count },
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

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callTimerSet(mock, 1, 100, 3);
    s.expectRegisters({
      R0: 0,
      R3: 0x3333,
      R4: 0x4444,
    });
  });
});
