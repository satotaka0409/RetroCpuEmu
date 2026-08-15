/**
 * g_hshk_addr_break_set / clr（IO→CPU コマンド 40h / 41h）
 * 根拠: HandShake.mdc「アドレスブレイク設定」「メモリ/IOブレイク解除」
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

/** 1 スロットのワード数（ena / flags / count / addr_hi / addr_lo / data） */
const SLOT_WORDS = 6;
/** スロット数（比較器 8 本すべてユーザ） */
const SLOT_COUNT = 8;

/** WRITE + 履歴（Bit1 + Bit5） */
const FLAGS_WRITE_HIST = 0x22;
/** ブレイクまでのカウント */
const HIT_COUNT = 3;
/** 監視バイトアドレス */
const BREAK_ADDR = 0x00003000;
/** 比較データ */
const BREAK_DATA = 0x1234;

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
 * ハンドラを `` で呼び、IO→CPU 交換と並行する。
 * @param mock IO モック
 * @param toCpu IO→CPU フレーム
 * @param fromCpu CPU→IO 待ちバイト数
 * @returns CPU→IO 応答
 */
async function callHandler(
  mock: IoBoardHandshakeMock,
  toCpu: Uint8Array,
  fromCpu: number,
): Promise<Uint8Array> {
  const io = mock.exchangeWithCpu(toCpu, fromCpu);
  await waitReq1(mock);
  await session.call("g_handshake_interrupt_handler", {
    registers: { ...BASE_REGS },
  });
  return io;
}

/**
 * 40h フレーム（cmd + slot + flags + count + addr32 BE + data16 BE）。
 * @param slot 設定番号 0–7（範囲外もテスト用にそのまま載せる）
 * @param flags Bit0 MEM/IO, Bit1 RD/WR, Bit2–4 条件, Bit5 履歴
 * @param count ブレイクまでのカウント
 * @param addr 監視アドレス（32bit バイト）
 * @param data 比較データ（16bit）
 * @returns IO→CPU フレーム
 */
function breakSetFrame(
  slot: number,
  flags: number,
  count: number,
  addr: number,
  data: number,
): Uint8Array {
  const a = addr >>> 0;
  const d = data & 0xffff;
  return Uint8Array.from([
    0x40,
    slot & 0xff,
    flags & 0xff,
    count & 0xff,
    (a >>> 24) & 0xff,
    (a >>> 16) & 0xff,
    (a >>> 8) & 0xff,
    a & 0xff,
    (d >>> 8) & 0xff,
    d & 0xff,
  ]);
}

/**
 * スロット 6 ワードを読む。
 * @param s セッション
 * @param slot 0–7
 * @returns [ena, flags, count, addrHi, addrLo, data]
 */
function readSlot(s: Mn1613AsmSession, slot: number): number[] {
  const base = s.wordAddr("GL_HSHK_ADDR_BREAK") + slot * SLOT_WORDS;
  return Array.from({ length: SLOT_WORDS }, (_, i) => s.readWord(base + i));
}

test("g_main 後、8 スロットはすべて 0", async () => {
  await withCase(async (s) => {
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      expect(readSlot(s, slot)).toEqual([0, 0, 0, 0, 0, 0]);
    }
  });
});

test("40h はスロット 0 に flags/count/addr/data を書き OK を返す", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      breakSetFrame(0, FLAGS_WRITE_HIST, HIT_COUNT, BREAK_ADDR, BREAK_DATA),
      1,
    );
    expect(Array.from(reply)).toEqual([0x00]);
    expect(readSlot(s, 0)).toEqual([
      1,
      FLAGS_WRITE_HIST,
      HIT_COUNT,
      (BREAK_ADDR >>> 16) & 0xffff,
      BREAK_ADDR & 0xffff,
      BREAK_DATA,
    ]);
    expect(readSlot(s, 1)).toEqual([0, 0, 0, 0, 0, 0]);
    s.expectRegisters({ R0: 0, R4: 0x4444 });
  });
});

test("40h はスロット 7 にも設定できる", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      breakSetFrame(7, 0x01, 0, 0x00000020, 0x00ab),
      1,
    );
    expect(Array.from(reply)).toEqual([0x00]);
    expect(readSlot(s, 7)).toEqual([1, 0x01, 0, 0x0000, 0x0020, 0x00ab]);
  });
});

test("40h スロット 8 は NG で表を変えない", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      breakSetFrame(8, FLAGS_WRITE_HIST, HIT_COUNT, BREAK_ADDR, BREAK_DATA),
      1,
    );
    expect(Array.from(reply)).toEqual([0x01]);
    expect(readSlot(s, 0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(readSlot(s, 7)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

test("41h は指定スロットをクリアして OK を返す", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      breakSetFrame(0, FLAGS_WRITE_HIST, HIT_COUNT, BREAK_ADDR, BREAK_DATA),
      1,
    );
    await callHandler(
      mock,
      breakSetFrame(1, 0x00, 1, 0x00001800, 0x5555),
      1,
    );
    const reply = await callHandler(mock, Uint8Array.from([0x41, 0x00]), 1);
    expect(Array.from(reply)).toEqual([0x00]);
    expect(readSlot(s, 0)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(readSlot(s, 1)).toEqual([1, 0x00, 1, 0x0000, 0x1800, 0x5555]);
  });
});

test("41h スロット 8 は NG", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      breakSetFrame(0, FLAGS_WRITE_HIST, HIT_COUNT, BREAK_ADDR, BREAK_DATA),
      1,
    );
    const reply = await callHandler(mock, Uint8Array.from([0x41, 0x08]), 1);
    expect(Array.from(reply)).toEqual([0x01]);
    expect(readSlot(s, 0)[0]).toBe(1);
  });
});

test("R3/R4 は 40h/41h の前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      breakSetFrame(2, 0x20, 0, 0x0000abcd, 0x1111),
      1,
    );
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    await callHandler(mock, Uint8Array.from([0x41, 0x02]), 1);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
