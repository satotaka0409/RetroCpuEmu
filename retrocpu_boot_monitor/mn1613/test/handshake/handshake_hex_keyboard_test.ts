/**
 * g_bios_hex_key_get（CPU→IO コマンド 11h）
 * 根拠: HandShake.mdc「16進キー入力取得」/ boot_monitor.mdc / test_framework.mdc
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

/** ユーザ RAM 上の結果バッファ（ワードアドレス） */
const KEY_BUF = 0x1800;

/** フリーモード（ハンドシェイク 10h の値） */
const MODE_FREE = 1;

/** 列 0–7 の押下ビットマップ */
const HEX_COLS = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80] as const;

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
 * g_bios_hex_key_get を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param bufWordAddr 結果バッファ先頭
 */
async function callHexKey(
  mock: IoBoardHandshakeMock,
  bufWordAddr: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_hex_key_get", {
      registers: { ...BASE_REGS, R0: bufWordAddr },
    }),
    mock.handleOneRequest(),
  ]);
}

/**
 * バッファ 8 ワードの下位 8bit を読む。
 * @param s セッション
 * @param wordAddr 先頭
 * @returns 列 0–7
 */
function readKeyBuf(s: Mn1613AsmSession, wordAddr: number): number[] {
  return Array.from({ length: 8 }, (_, i) => s.readWord(wordAddr + i) & 0xff);
}

test("フリーモードで列 0–7 のビットマップがバッファに入る", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    mock.setHexKeys([...HEX_COLS]);
    await callHexKey(mock, KEY_BUF);
    s.expectRegisters({ R0: 0 });
    expect(readKeyBuf(s, KEY_BUF)).toEqual([...HEX_COLS]);
  });
});

test("モニターモードでは 01h を返し列は 0", async () => {
  await withCase(async (s, mock) => {
    mock.setHexKeys([...HEX_COLS]);
    await callHexKey(mock, KEY_BUF);
    s.expectRegisters({ R0: 1 });
    expect(readKeyBuf(s, KEY_BUF)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    mock.setHexKeys([...HEX_COLS]);
    await callHexKey(mock, KEY_BUF);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
