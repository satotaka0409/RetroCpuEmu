/**
 * g_hshk_write_memory（IO→CPU コマンド 51h）
 * 根拠: HandShake.mdc「メモリ書き込み」/ boot_monitor.mdc / test_framework.mdc
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
 * 51h ヘッダ＋データ＋チェックサム。
 * @param byteAddr バイトアドレス
 * @param data 書き込みバイト
 * @returns IO→CPU フレーム
 */
function memWriteFrame(byteAddr: number, data: readonly number[]): Uint8Array {
  const count = data.length;
  return Uint8Array.from([
    0x51,
    (byteAddr >>> 24) & 0xff,
    (byteAddr >>> 16) & 0xff,
    (byteAddr >>> 8) & 0xff,
    byteAddr & 0xff,
    (count >>> 24) & 0xff,
    (count >>> 16) & 0xff,
    (count >>> 8) & 0xff,
    count & 0xff,
    ...data,
    blockChecksum(data),
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
 * 51h を IRQ ハンドラ経由で実行する。
 * @param mock IO モック
 * @param toCpu IO→CPU（ヘッダ＋データ＋checksum。件数0はヘッダのみ）
 * @param fromCpu CPU→IO 待ちバイト数（status。件数0は 0）
 * @returns CPU→IO status
 */
async function callWrite(
  mock: IoBoardHandshakeMock,
  toCpu: Uint8Array,
  fromCpu = 1,
): Promise<Uint8Array> {
  const io = mock.exchangeWithCpu(toCpu, fromCpu);
  await waitReq1(mock);
  await session.call("g_handshake_interrupt_handler", {
    registers: { ...BASE_REGS },
  });
  return io;
}

test("51h は指定バイトをビッグエンディアンで書き OK を返す", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0);
    s.writeWord(WORD_ADDR + 1, 0);
    const data = [0x12, 0x34, 0xab, 0xcd];
    const reply = await callWrite(mock, memWriteFrame(BYTE_ADDR, data));
    expect(Array.from(reply)).toEqual([0x00]);
    expect(s.readWord(WORD_ADDR)).toBe(0x1234);
    expect(s.readWord(WORD_ADDR + 1)).toBe(0xabcd);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
    const heap = await s.call("g_malloc", { registers: { R0: 256 } });
    expect(heap.registers.R[0]).toBeTruthy();
    await s.call("g_free", { registers: { R0: heap.registers.R[0] } });
  });
});

test("51h 奇数バイトアドレスへ 1 バイト書ける", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x1234);
    const reply = await callWrite(mock, memWriteFrame(BYTE_ADDR + 1, [0xaa]));
    expect(Array.from(reply)).toEqual([0x00]);
    expect(s.readWord(WORD_ADDR)).toBe(0x12aa);
  });
});

test("51h バイト数 0 はデータなしで完了する", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(WORD_ADDR, 0x5555);
    const reply = await callWrite(
      mock,
      Uint8Array.from([
        0x51,
        (BYTE_ADDR >>> 24) & 0xff,
        (BYTE_ADDR >>> 16) & 0xff,
        (BYTE_ADDR >>> 8) & 0xff,
        BYTE_ADDR & 0xff,
        0,
        0,
        0,
        0,
      ]),
      0,
    );
    expect(reply.length).toBe(0);
    expect(s.readWord(WORD_ADDR)).toBe(0x5555);
    s.expectRegisters({ R4: 0x4444 });
  });
});
