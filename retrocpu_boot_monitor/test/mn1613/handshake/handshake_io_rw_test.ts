/**
 * g_hshk_read_io / g_hshk_write_io（IO→CPU 15h / 16h）
 * 根拠: HandShake.mdc「IO読み出し」「IO書き込み」
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
 * g_main 済み＋ handshake モックで 1 ケースを実行する。
 * @param fn 本体
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
 * IO が HSHK_IN_REQ を上げるまで待つ。
 * @param mock IO モック
 * @param timeoutMs 上限 ms
 */
async function waitReq1(
  mock: IoBoardHandshakeMock,
  timeoutMs = 2000,
): Promise<void> {
  const t0 = Date.now();
  while (mock.bus.HSHK_IN_REQ !== 1) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("timeout waiting HSHK_IN_REQ");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

test("15h は指定バイト数＋status を返す", async () => {
  await withCase(async (s, mock) => {
    const toCpu = Uint8Array.from([0x15, 0x00, 0x00, 0xa0, 0x02, 0x00]);
    const io = mock.exchangeWithCpu(toCpu, 3);
    await waitReq1(mock);
    await s.call("g_handshake_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    const reply = await io;
    expect(reply.length).toBe(3);
    expect(reply[2]).toBe(0);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});
