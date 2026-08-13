/**
 * g_hshk_read_memory（IO→CPU コマンド 50h）
 * 根拠: HandShake.mdc「メモリ読み出し」/ boot_monitor.mdc / test_framework.mdc
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

/** ユーザ RAM 先頭（ワード）。バイトアドレス = 0x3000 */
const WORD_ADDR = 0x1800;
const BYTE_ADDR = WORD_ADDR * 2;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

/**
 * ブロックのチェックサム（各バイト加算の下位 8bit）。
 * @param data ブロック
 * @returns 0–255
 */
function blockChecksum(data: readonly number[]): number {
  return data.reduce((s, b) => (s + (b & 0xff)) & 0xff, 0);
}

/**
 * 50h ヘッダ（cmd + addr32 BE + count32 BE）。
 * @param byteAddr バイトアドレス
 * @param byteCount バイト数
 * @returns IO→CPU 先頭フレーム
 */
function memReadHeader(byteAddr: number, byteCount: number): Uint8Array {
  return Uint8Array.from([
    0x50,
    (byteAddr >>> 24) & 0xff,
    (byteAddr >>> 16) & 0xff,
    (byteAddr >>> 8) & 0xff,
    byteAddr & 0xff,
    (byteCount >>> 24) & 0xff,
    (byteCount >>> 16) & 0xff,
    (byteCount >>> 8) & 0xff,
    byteCount & 0xff,
  ]);
}

/**
 * g_main 済み＋ ioMock handshake で 1 ケースを実行する。
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
 * IO が HSHK_REQ_1 を上げるまで待つ。
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
 * 50h を IRQ ハンドラ経由で実行する。
 * @param mock IO モック
 * @param toCpu IO→CPU（ヘッダ）
 * @param fromCpu CPU→IO 待ちバイト数（データ+checksum）
 * @param thenToCpu status（OK/NG）
 * @returns CPU→IO 応答
 */
async function callRead(
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

test("50h は指定バイトをビッグエンディアンで返しチェックサムを付ける", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x1234);
    s.writeWord(WORD_ADDR + 1, 0xabcd);
    const data = [0x12, 0x34, 0xab, 0xcd];
    const reply = await callRead(
      mock,
      memReadHeader(BYTE_ADDR, 4),
      5,
      Uint8Array.from([0x00]),
    );
    expect(Array.from(reply)).toEqual([...data, blockChecksum(data)]);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("50h 奇数バイトアドレスから読める", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x1234);
    s.writeWord(WORD_ADDR + 1, 0xabcd);
    const data = [0x34, 0xab];
    const reply = await callRead(
      mock,
      memReadHeader(BYTE_ADDR + 1, 2),
      3,
      Uint8Array.from([0x00]),
    );
    expect(Array.from(reply)).toEqual([...data, blockChecksum(data)]);
  });
});

test("50h バイト数 0 はデータなしで完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callRead(mock, memReadHeader(BYTE_ADDR, 0), 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R4: 0x4444 });
  });
});
