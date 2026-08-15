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

/** デバッグダンプ窓 ±800h ワード（16 ワード境界）のバイト数 */
const DUMP_WINDOW_BYTES = 0x1220;

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
 * 13h を IRQ ハンドラ経由で実行する。
 * @param mock IO モック
 * @param toCpu IO→CPU（ヘッダ 10B）
 * @param fromCpu CPU→IO 待ちバイト数（データ）
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

test("13h は指定バイトをビッグエンディアンで返す", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x1234);
    s.writeWord(WORD_ADDR + 1, 0xabcd);
    const data = [0x12, 0x34, 0xab, 0xcd];
    const reply = await callRead(
      mock,
      memReadHeader(BYTE_ADDR, 4),
      4,
      Uint8Array.from([0x00]),
    );
    expect(Array.from(reply)).toEqual(data);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("13h はワード 8000h（バイト 10000h、byte_hi の LSB）を読む", async () => {
  await withCase(async (s, mock) => {
    const word = 0x8000;
    s.writeWord(word, 0xa5a5);
    const reply = await callRead(
      mock,
      memReadHeader(word * 2, 2),
      2,
      Uint8Array.from([0x00]),
    );
    expect(Array.from(reply)).toEqual([0xa5, 0xa5]);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("13h 奇数バイトアドレスから読める", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x1234);
    s.writeWord(WORD_ADDR + 1, 0xabcd);
    const data = [0x34, 0xab];
    const reply = await callRead(
      mock,
      memReadHeader(BYTE_ADDR + 1, 2),
      2,
      Uint8Array.from([0x00]),
    );
    expect(Array.from(reply)).toEqual([...data]);
  });
});

test("13h バイト数 0 はデータなしで完了する", async () => {
  await withCase(async (s, mock) => {
    const reply = await callRead(
      mock,
      memReadHeader(BYTE_ADDR, 0),
      0,
      Uint8Array.from([0x00]),
    );
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
function fillPattern(s: Mn1613AsmSession, byteAddr: number, n: number): number[] {
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

/**
 * 13h を IoControlHandshake.memRead で実行する。
 * @param mock IO モック
 * @param byteAddr 開始バイトアドレス
 * @param byteCount バイト数
 * @returns 読み出したバイト
 */
async function callMemReadBlocks(
  mock: IoBoardHandshakeMock,
  byteAddr: number,
  byteCount: number,
): Promise<Uint8Array> {
  const io = mock.memReadFromCpu(byteAddr, byteCount);
  await waitReq1(mock);
  await session.call("g_handshake_interrupt_handler", {
    registers: { ...BASE_REGS },
  });
  return io;
}

test("13h は 257 バイトを返す", async () => {
  await withCase(async (s, mock) => {
    const n = 257;
    const expected = fillPattern(s, BYTE_ADDR, n);
    const reply = await callMemReadBlocks(mock, BYTE_ADDR, n);
    expect(Array.from(reply)).toEqual(expected);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("13h はダンプ窓 0x1220 バイトを返す", async () => {
  await withCase(async (s, mock) => {
    const expected = fillPattern(s, BYTE_ADDR, DUMP_WINDOW_BYTES);
    const reply = await callMemReadBlocks(mock, BYTE_ADDR, DUMP_WINDOW_BYTES);
    expect(reply.length).toBe(DUMP_WINDOW_BYTES);
    expect(Array.from(reply)).toEqual(expected);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});
