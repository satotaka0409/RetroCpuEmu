/**
 * g_handshake_interrupt_handler（IO→CPU コマンド 10h–18h）
 * 根拠: HandShake.mdc / boot_monitor.mdc / test_framework.mdc
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
 * IO が HSHK_IN_REQ を上げるまで待つ（受理より先に依頼を出す）。
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

/**
 * ハンドラを `` で呼び、IO→CPU 交換と並行する。
 * IO が REQ_1 を上げてから CPU を動かす（ENA0 競合を避ける）。
 * @param mock IO モック
 * @param toCpu IO→CPU フレーム
 * @param fromCpu CPU→IO 待ちバイト数
 * @param thenToCpu 応答後の追加 IO→CPU
 * @returns CPU→IO 応答
 */
async function callHandler(
  mock: IoBoardHandshakeMock,
  toCpu: Uint8Array,
  fromCpu: number,
  thenToCpu?: Uint8Array,
): Promise<Uint8Array> {
  const io = mock.exchangeWithCpu(toCpu, fromCpu, thenToCpu);
  await waitReq1(mock);
  await session.call("g_handshake_interrupt_handler", {
    registers: { ...BASE_REGS },
  });
  return io;
}

test("0x0F（<0x10）はディスパッチせず完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(mock, Uint8Array.from([0x0f]), 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("0x44 未実装コマンドは NG も返さず完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(mock, Uint8Array.from([0x44]), 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("12h 実行指示は 5B（pad 含む）を読み NG を返す", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x12, 0, 0, 0x02, 0x00, 0x00]),
      1,
    );
    expect(Array.from(reply)).toEqual([0x01]);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("0x48（廃止の CPU状態取得）は NG も返さず完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(mock, Uint8Array.from([0x48]), 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});
