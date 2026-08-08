/**
 * gl_handshake_interrupt_handler（IO→CPU コマンド 40h–60h）
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
 * IO が HSHK_REQ_1 を上げるまで待つ（受理より先に依頼を出す）。
 * @param mock IO モック
 * @param timeoutMs 上限 ms
 */
async function waitReq1(
  mock: IoBoardHandshakeMock,
  timeoutMs = 2000,
): Promise<void> {
  const t0 = Date.now();
  while (mock.bus.HSHK_REQ_1 !== 1) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("timeout waiting HSHK_REQ_1");
    }
    await new Promise((r) => setTimeout(r, 1));
  }
}

/**
 * ハンドラを RETL 戻りで呼び、IO→CPU 交換と並行する。
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
  await session.call("gl_handshake_interrupt_handler", {
    retl: true,
    registers: { ...BASE_REGS },
  });
  return io;
}

test("0x10（<0x40）はディスパッチせず完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(mock, Uint8Array.from([0x10]), 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R0: 0, R2: 0x2222, R4: 0x4444 });
  });
});

test("0x44 未実装コマンドは NG も返さず完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(mock, Uint8Array.from([0x44]), 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R0: 0, R2: 0x2222, R4: 0x4444 });
  });
});

test("41h ブレイク解除はペイロード 1B を読み NG を返す", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x41, 0x00]),
      1,
    );
    expect(Array.from(reply)).toEqual([0x01]);
    s.expectRegisters({ R0: 0, R2: 0x2222, R4: 0x4444 });
  });
});

test("40h メモリ/IO ブレイク設定は 9B を読み NG を返す", async () => {
  await withCase(async (s, mock) => {
    const frame = new Uint8Array(10);
    frame[0] = 0x40;
    const reply = await callHandler(mock, frame, 1);
    expect(Array.from(reply)).toEqual([0x01]);
    s.expectRegisters({ R0: 0, R2: 0x2222, R4: 0x4444 });
  });
});

test("49h 実行指示は 4B を読み NG を返す", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x49, 0, 0, 0x02, 0x00]),
      1,
    );
    expect(Array.from(reply)).toEqual([0x01]);
    s.expectRegisters({ R0: 0, R2: 0x2222, R4: 0x4444 });
  });
});

test("48h CPU 状態取得は 0x28 バイトの 0 を返し OK を受け取る", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x48]),
      0x28,
      Uint8Array.from([0x00]),
    );
    expect(reply.length).toBe(0x28);
    expect(Array.from(reply).every((b) => b === 0)).toBe(true);
    s.expectRegisters({ R0: 0, R2: 0x2222, R4: 0x4444 });
  });
});
