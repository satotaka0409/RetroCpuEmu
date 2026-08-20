/**
 * g_bios_lcd_control（CPU→IO コマンド 17h）
 * 根拠: HandShake.mdc「LCD制御」/ boot_monitor.mdc / test_framework.mdc
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
 * g_bios_lcd_control を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param kind 種別（R0）
 * @param argA 引数A（R1）
 * @param argB 引数B（R2 Bit8–9）
 * @param argC 引数C（R2 Bit0–7）
 */
async function callLcd1(
  mock: IoBoardHandshakeMock,
  kind: number,
  argA: number,
  argB: number,
  argC: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_lcd_control", {
      registers: {
        ...BASE_REGS,
        R0: kind,
        R1: argA,
        R2: ((argB & 3) << 8) | (argC & 0xff),
      },
    }),
    mock.handleOneRequest(),
  ]);
}

test("17h フレーム（kind/argA/argB/argC）を正しく送る", async () => {
  await withCase(async (s, mock) => {
    await callLcd1(mock, 3, 0x05, 0x01, 0x0f);

    const last = mock.state.log.at(-1);
    expect(last).toBeTruthy();
    expect(last!.dir).toBe("cpu_to_io");
    expect(last!.cmd).toBe(0x17);
    expect(Array.from(last!.frame)).toEqual([0x17, 0x03, 0x05, 0x01, 0x0f]);

    const status = last!.response?.[0] ?? 0;
    s.expectRegisters({ R0: status & 0xff });
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callLcd1(mock, 2, 0x07, 0x00, 0x00);
    s.expectRegisters({ R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
