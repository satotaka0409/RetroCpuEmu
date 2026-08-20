/**
 * g_bios_lcd_text（CPU→IO コマンド 18h）
 * 根拠: HandShake.mdc「LCD文字列表示」/ boot_monitor.mdc / test_framework.mdc
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

/** 文字列バッファ（ワードアドレス、1ワード1バイト） */
const TEXT_BUF = 0x1a00;

const BASE_REGS = {
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
 * ワードバッファへ 1 バイト／ワードで書く。
 * @param s セッション
 * @param wordAddr 先頭ワードアドレス
 * @param bytes 下位 8bit ずつ
 */
function writeByteWords(
  s: Mn1613AsmSession,
  wordAddr: number,
  bytes: readonly number[],
): void {
  for (let i = 0; i < bytes.length; i += 1) {
    s.writeWord(wordAddr + i, bytes[i]! & 0xff);
  }
}

/**
 * g_bios_lcd_text を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param row 行（R0 Bit8–9）
 * @param col 列（R0 Bit0–7）
 * @param len 文字数（R1）
 * @param textAddr 文字列先頭（R2）
 */
async function callLcd2(
  mock: IoBoardHandshakeMock,
  row: number,
  col: number,
  len: number,
  textAddr: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_lcd_text", {
      registers: {
        ...BASE_REGS,
        R0: ((row & 0x3) << 8) | (col & 0xff),
        R1: len,
        R2: textAddr,
        R3: 0x3333,
      },
    }),
    mock.handleOneRequest(),
  ]);
}

test("18h フレームを20バイトで送り、len以降は空白で埋める", async () => {
  await withCase(async (s, mock) => {
    writeByteWords(s, TEXT_BUF, [0x41, 0x42, 0x43, 0x44, 0x45]); // ABCDE

    await callLcd2(mock, 1, 2, 5, TEXT_BUF);

    const last = mock.state.log.at(-1);
    expect(last).toBeTruthy();
    expect(last!.cmd).toBe(0x18);
    expect(last!.frame.length).toBe(20);
    expect(Array.from(last!.frame.slice(0, 4))).toEqual([
      0x18, 0x01, 0x02, 0x05,
    ]);
    expect(Array.from(last!.frame.slice(4, 9))).toEqual([
      0x41, 0x42, 0x43, 0x44, 0x45,
    ]);
    expect(Array.from(last!.frame.slice(9))).toEqual(new Array(11).fill(0x20));

    const status = last!.response?.[0] ?? 0;
    s.expectRegisters({ R0: status & 0xff });
  });
});

test("len が 16 を超えると先頭16文字だけ送る", async () => {
  await withCase(async (s, mock) => {
    const chars = Array.from({ length: 18 }, (_, i) => 0x41 + i); // A..R
    writeByteWords(s, TEXT_BUF, chars);

    await callLcd2(mock, 0, 0, 18, TEXT_BUF);

    const last = mock.state.log.at(-1);
    expect(last).toBeTruthy();
    expect(last!.cmd).toBe(0x18);
    expect(Array.from(last!.frame.slice(4))).toEqual(chars.slice(0, 16));
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    writeByteWords(s, TEXT_BUF, [0x48, 0x49]); // HI
    await callLcd2(mock, 0, 0, 2, TEXT_BUF);
    s.expectRegisters({ R3: 0x3333, R4: BASE_REGS.R4 });
  });
});
