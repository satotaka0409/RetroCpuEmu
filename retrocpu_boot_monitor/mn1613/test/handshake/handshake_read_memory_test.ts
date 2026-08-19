/**
 * g_hshk_read_memory（IO→CPU コマンド 13h）
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
  withMn1613CpuLog(
    {
      ...mn1613MonHandshakeSettings,
      maxCycles: 250_000_000,
      ioMock: [{ type: "handshake", timeoutMs: 30_000, syncIrq2: false }],
    },
    import.meta.url,
  ),
);

/** 13h メモリ転送テストの上限（MN1613 前提で 8KB 以内） */
const MAX_MEMREAD_TEST_BYTES = 0x2000;
/** 実行時間を抑えるための実テストサイズ（512B） */
const MEMREAD_TEST_BYTES = 0x0200;

/**
 * 13h ヘッダ（cmd + addr32 BE + count32 BE + パッド）。
 * @param byteAddr バイトアドレス
 * @param byteCount バイト数
 * @returns IO→CPU 先頭フレーム
 */
function memReadHeader(byteAddr: number, byteCount: number): Uint8Array {
  return Uint8Array.from([
    0x13,
    (byteAddr >>> 24) & 0xff,
    (byteAddr >>> 16) & 0xff,
    (byteAddr >>> 8) & 0xff,
    byteAddr & 0xff,
    (byteCount >>> 24) & 0xff,
    (byteCount >>> 16) & 0xff,
    (byteCount >>> 8) & 0xff,
    byteCount & 0xff,
    0,
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

/**
 * 13h を IRQ ハンドラ経由で実行する。
 * @param mock IO モック
 * @param byteAddr 開始バイトアドレス
 * @param byteCount CPU→IO で受け取るデータ長
 * @returns CPU→IO 応答
 */
async function callRead(
  mock: IoBoardHandshakeMock,
  byteAddr: number,
  byteCount: number,
): Promise<Uint8Array> {
  const io = mock.exchangeWithCpu(
    memReadHeader(byteAddr, byteCount),
    byteCount,
    Uint8Array.from([0x00]),
  );
  await waitReq1(mock);
  await session.call("g_handshake_interrupt_handler", {
    registers: { ...BASE_REGS },
  });
  return io;
}

test("13h は指定バイトをビッグエンディアンで返す", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x1234);
    s.writeWord(WORD_ADDR + 1, 0xabcd);
    const data = [0x12, 0x34, 0xab, 0xcd];
    const reply = await callRead(mock, BYTE_ADDR, 4);
    expect(Array.from(reply)).toEqual(data);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("13h はワード 8000h（バイト 10000h、byte_hi の LSB）を読む", async () => {
  await withCase(async (s, mock) => {
    const word = 0x8000;
    s.writeWord(word, 0xa5a5);
    const reply = await callRead(mock, word * 2, 2);
    expect(Array.from(reply)).toEqual([0xa5, 0xa5]);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("13h バイト数 0 はデータなしで完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callRead(mock, BYTE_ADDR, 0);
    expect(reply.length).toBe(0);
    s.expectRegisters({ R4: 0x4444 });
  });
});

/**
 * パターンバイト列をユーザ RAM に書く。
 * @param s セッション
 * @param byteAddr 開始バイトアドレス
 * @param n バイト数
 * @returns 書いた列
 */
function fillPattern(
  s: Mn1613AsmSession,
  byteAddr: number,
  n: number,
): number[] {
  const data: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const b = (i * 13 + 7) & 0xff;
    data.push(b);
    const waddr = (byteAddr + i) >>> 1;
    const cur = s.readWord(waddr);
    if ((byteAddr + i) & 1) {
      s.writeWord(waddr, (cur & 0xff00) | b);
    } else {
      s.writeWord(waddr, (b << 8) | (cur & 0x00ff));
    }
  }
  return data;
}

test("13h は 256 バイトを返す", async () => {
  await withCase(async (s, mock) => {
    const n = 256;
    const expected = fillPattern(s, BYTE_ADDR, n);
    const reply = await callRead(mock, BYTE_ADDR, n);
    expect(Array.from(reply)).toEqual(expected);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("13h は実用サイズ（512B、上限8KB以内）を返す", async () => {
  await withCase(async (s, mock) => {
    if (MEMREAD_TEST_BYTES > MAX_MEMREAD_TEST_BYTES) {
      throw new Error("MEMREAD_TEST_BYTES must be <= 8KB");
    }
    const expected = fillPattern(s, BYTE_ADDR, MEMREAD_TEST_BYTES);
    const reply = await callRead(mock, BYTE_ADDR, MEMREAD_TEST_BYTES);
    expect(reply.length).toBe(MEMREAD_TEST_BYTES);
    expect(Array.from(reply)).toEqual(expected);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});
