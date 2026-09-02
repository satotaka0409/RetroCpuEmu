/**
 * g_bios_undef_led（CPU→IO コマンド 13h）
 * 根拠: HandShake.mdc「未定義命令実行通知」/ boot_monitor.mdc / test_framework.mdc
 */
import {
  createSessionFromSettings,
  expect,
  test,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework_ts/src/index.js";
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
 * @param on 互換引数（旧 Bit0 指定。現仕様では未使用）
 */
async function callUndefLed(
  mock: IoBoardHandshakeMock,
  on: number,
): Promise<void> {
  const io = mock.handleOneRequest();
  await session.call("g_bios_undef_led", {
    registers: { ...BASE_REGS, R0: on },
  });
  await io;
}

test("点灯(1)で IO の undefLed が true になる", async () => {
  await withCase(async (s, mock) => {
    expect(mock.state.undefLed).toBe(false);
    await callUndefLed(mock, 1);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.undefLed).toBe(true);
    expect(mock.state.lastUndefNotify !== null).toBe(true);
  });
});

test("引数 0 でも 13h 通知として処理され、undefLed は true になる", async () => {
  await withCase(async (s, mock) => {
    expect(mock.state.undefLed).toBe(false);
    await callUndefLed(mock, 0);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.undefLed).toBe(true);
    expect(mock.state.lastUndefNotify !== null).toBe(true);
  });
});

test("引数 0x03 でも 13h 通知として処理される", async () => {
  await withCase(async (s, mock) => {
    await callUndefLed(mock, 0x03);
    s.expectRegisters({ R0: 0 });
    expect(mock.state.undefLed).toBe(true);
    expect(mock.state.lastUndefNotify !== null).toBe(true);
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callUndefLed(mock, 1);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
