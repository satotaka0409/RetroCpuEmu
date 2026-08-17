/**
 * g_hshk_break_hist_get（IO→CPU コマンド 17h）
 * 根拠: HandShake.mdc「ブレイク履歴取得」
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
 * g_main 済み＋ handshake で 1 ケースを実行する。
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
 * ハンドラを call で呼び、IO→CPU 交換と並行する。
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

test("17h スロット 8 はヘッダ 0 のあと NG", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x08, 0x00]),
      9,
    );
    expect(Array.from(reply)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0x01]);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });
  });
});

test("17h 履歴未設定は件数 0 で 02h", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0x42, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      9,
    );
    expect(reply[0]).toBe(0);
    expect(reply[1]).toBe(0x02);
    expect(reply[2]).toBe(0x42);
    expect(reply[6]).toBe(0x30);
    expect(reply[7]).toBe(0x00);
    expect(reply[8]).toBe(0x02);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });
  });
});

test("17h 履歴設定で件数 0 なら OK", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      9,
    );
    expect(reply.length).toBe(9);
    expect(reply[0]).toBe(0);
    expect(reply[1]).toBe(0);
    expect(reply[2]).toBe(0xc2);
    expect(reply[3]).toBe(0x04);
    expect(reply[8]).toBe(0x00);
    s.expectRegisters({ R0: 0x00, R4: BASE_REGS.R4 });
  });
});

/**
 * 履歴エントリ 33 語を物理 3F000h 領域へ置く。
 * @param s セッション
 * @param slot 0–7
 * @param index リング index 0–15
 * @param mark 先頭ワード（識別用）
 */
function plantEntry(
  s: Mn1613AsmSession,
  slot: number,
  index: number,
  mark: number,
): void {
  const base = 0x3f000 + slot * 528 + index * 33;
  s.writeWord(base, mark);
  s.writeWord(base + 1, 0x4567);
  s.writeWord(base + 2, 0x89ab);
  s.writeWord(base + 3, 0xcdef);
  s.writeWord(base + 4, 0xa5a5);
  s.writeWord(base + 5, 0x0000);
  for (let i = 6; i < 33; i += 1) {
    s.writeWord(base + i, 0x1000 + i);
  }
}

test("17h 履歴 1 件を新しい順で返す", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const meta = s.wordAddr("GL_BP_HIST_META");
    s.writeWord(meta, 1);
    s.writeWord(meta + 1, 1);
    s.writeWord(meta + 2, 0);
    plantEntry(s, 0, 0, 0x0123);
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      8 + 66 + 1,
    );
    expect(reply[0]).toBe(1);
    expect(reply[1]).toBe(0);
    expect((reply[8]! << 8) | reply[9]!).toBe(0x0123);
    expect((reply[16]! << 8) | reply[17]!).toBe(0xa5a5);
    expect(reply[reply.length - 1]).toBe(0x00);
  });
});

test("17h は 2 件を新しい順（後に書いた方から）で返す", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const meta = s.wordAddr("GL_BP_HIST_META");
    s.writeWord(meta, 2);
    s.writeWord(meta + 1, 2);
    s.writeWord(meta + 2, 0);
    plantEntry(s, 0, 0, 0x0001);
    plantEntry(s, 0, 1, 0x0002);
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      8 + 66 * 2 + 1,
    );
    expect(reply[0]).toBe(2);
    expect((reply[8]! << 8) | reply[9]!).toBe(0x0002);
    expect((reply[8 + 66]! << 8) | reply[9 + 66]!).toBe(0x0001);
    expect(reply[reply.length - 1]).toBe(0x00);
  });
});

test("17h スロット 7 は slot×528 先のエントリを返す", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x07, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const meta = s.wordAddr("GL_BP_HIST_META") + 7 * 3;
    s.writeWord(meta, 1);
    s.writeWord(meta + 1, 1);
    s.writeWord(meta + 2, 0);
    plantEntry(s, 7, 0, 0x7777);
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x07, 0x00]),
      8 + 66 + 1,
    );
    expect(reply[0]).toBe(1);
    expect((reply[8]! << 8) | reply[9]!).toBe(0x7777);
    expect(reply[reply.length - 1]).toBe(0x00);
  });
});

test("17h Bit0=1 は取得後に当該スロットの履歴をクリアする", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const meta = s.wordAddr("GL_BP_HIST_META");
    s.writeWord(meta, 1);
    s.writeWord(meta + 1, 1);
    s.writeWord(meta + 2, 1);
    plantEntry(s, 0, 0, 0x0123);
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x01]),
      8 + 66 + 1,
    );
    expect(reply[0]).toBe(1);
    expect(reply[1]).toBe(0x01);
    expect(reply[reply.length - 1]).toBe(0x00);
    expect(s.readWord(meta)).toBe(0);
    expect(s.readWord(meta + 1)).toBe(0);
    expect(s.readWord(meta + 2)).toBe(0);
  });
});

test("17h オーバフロー済みはステータス Bit0 を立てる", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const meta = s.wordAddr("GL_BP_HIST_META");
    s.writeWord(meta, 1);
    s.writeWord(meta + 1, 1);
    s.writeWord(meta + 2, 1);
    plantEntry(s, 0, 0, 0x00aa);
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      8 + 66 + 1,
    );
    expect(reply[0]).toBe(1);
    expect(reply[1]).toBe(0x01);
    expect((reply[8]! << 8) | reply[9]!).toBe(0x00aa);
    expect(reply[reply.length - 1]).toBe(0x00);
  });
});

test("17h 履歴 16 件を新しい順で返す", async () => {
  await withCase(async (s, mock) => {
    await callHandler(
      mock,
      Uint8Array.from([
        0x10, 0x00, 0xc2, 0x04, 0x00, 0x00, 0x30, 0x00, 0x00, 0x00,
      ]),
      1,
    );
    const meta = s.wordAddr("GL_BP_HIST_META");
    s.writeWord(meta, 16);
    s.writeWord(meta + 1, 16);
    s.writeWord(meta + 2, 0);
    for (let i = 0; i < 16; i += 1) {
      plantEntry(s, 0, i, 0x0100 + i);
    }

    const entrySize = 66;
    const reply = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      8 + entrySize * 16 + 1,
    );

    expect(reply.length).toBe(8 + entrySize * 16 + 1);
    expect(reply[0]).toBe(16);
    expect(reply[1]).toBe(0);
    expect((reply[8]! << 8) | reply[9]!).toBe(0x010f);
    expect((reply[8 + entrySize * 15]! << 8) | reply[9 + entrySize * 15]!).toBe(
      0x0100,
    );
    expect(reply[reply.length - 1]).toBe(0x00);
  });
});
