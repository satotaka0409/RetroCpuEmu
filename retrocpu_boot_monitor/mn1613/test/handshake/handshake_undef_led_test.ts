/**
 * g_bios_undef_led（CPU→IO コマンド 17h）
 * 根拠: HandShake.mdc「未定義命令LED」/ boot_monitor.mdc / test_framework.mdc
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
 * g_bios_undef_led を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param on Bit0（0=消灯 / 1=点灯）
 */
async function callUndefLed(
  mock: IoBoardHandshakeMock,
  on: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_undef_led", {
      registers: { ...BASE_REGS, R0: on },
    }),
    mock.handleOneRequest(),
  ]);
}

test("点灯(1)で IO の undefLed が true になる", async () => {
  await withCase(async (s, mock) => {
    expect(mock.state.undefLed).toBe(false);
    await callUndefLed(mock, 1);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.undefLed).toBe(true);
  });
});

test("消灯(0)で IO の undefLed が false になる", async () => {
  await withCase(async (s, mock) => {
    mock.state.undefLed = true;
    await callUndefLed(mock, 0);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.undefLed).toBe(false);
  });
});

test("Bit0 以外はマスクして送る（0x03 → 点灯）", async () => {
  await withCase(async (s, mock) => {
    await callUndefLed(mock, 0x03);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.undefLed).toBe(true);
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callUndefLed(mock, 1);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
