/**
 * g_bios_mode_set（CPU→IO コマンド 10h）
 * 根拠: HandShake.mdc「モード設定」/ boot_monitor.mdc / test_framework.mdc
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

/** モニターモード（ハンドシェイク 10h） */
const MODE_MONITOR = 0;
/** フリーモード（ハンドシェイク 10h） */
const MODE_FREE = 1;

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
 * g_bios_mode_set を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param mode 0=モニター / 1=フリー（それ以外は IO が NG）
 */
async function callModeSet(
  mock: IoBoardHandshakeMock,
  mode: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_mode_set", {
      registers: { ...BASE_REGS, R0: mode },
    }),
    mock.handleOneRequest(),
  ]);
}

test("フリーモードを設定すると IO の mode が 1 になる", async () => {
  await withCase(async (s, mock) => {
    expect(mock.state.mode).toBe(MODE_MONITOR);
    await callModeSet(mock, MODE_FREE);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.mode).toBe(MODE_FREE);
  });
});

test("モニターモードを設定すると IO の mode が 0 になる", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    await callModeSet(mock, MODE_MONITOR);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.mode).toBe(MODE_MONITOR);
  });
});

test("不正なモードは NG で、IO の mode は変わらない", async () => {
  await withCase(async (s, mock) => {
    expect(mock.state.mode).toBe(MODE_MONITOR);
    await callModeSet(mock, 2);
    s.expectRegisters({ R0: 1 });
    expect(mock.state.mode).toBe(MODE_MONITOR);
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callModeSet(mock, MODE_FREE);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
