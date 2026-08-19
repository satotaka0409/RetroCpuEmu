/**
 * g_bios_pc_key_get（CPU→IO コマンド 15h）
 * 根拠: HandShake.mdc「PCキー入力取得」/ boot_monitor.mdc / test_framework.mdc
 */
import {
  createSessionFromSettings,
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

/** 呼び出し後も保たれるはずのレジスタ（callee-saved） */
const SAVED = { R3: 0x3333, R4: 0x4444 } as const;

/** サンプル ASCII（'A'） */
const SAMPLE_ASCII = 0x41;
/** サンプルキーコード（ASCII と区別できる値） */
const SAMPLE_KEYCODE = 0x1e;

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
 * g_bios_pc_key_get を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 */
async function callPcKey(mock: IoBoardHandshakeMock): Promise<void> {
  await Promise.all([
    session.call("g_bios_pc_key_get", {
      registers: { ...BASE_REGS },
    }),
    mock.handleOneRequest(),
  ]);
}

test("未入力時は ASCII/キーコードとも 0 で OK", async () => {
  await withCase(async (s, mock) => {
    await callPcKey(mock);
    s.expectRegisters({ R0: 0, R1: 0, R2: 0, ...SAVED });
  });
});

test("差し込んだ ASCII とキーコードが R1/R2 に入る", async () => {
  await withCase(async (s, mock) => {
    mock.setPcKey(SAMPLE_ASCII, SAMPLE_KEYCODE);
    await callPcKey(mock);
    s.expectRegisters({
      R0: 0,
      R1: SAMPLE_ASCII,
      R2: SAMPLE_KEYCODE,
      ...SAVED,
    });
  });
});

test("モニターモードでも取得できる", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = 0;
    mock.setPcKey(SAMPLE_ASCII, SAMPLE_KEYCODE);
    await callPcKey(mock);
    s.expectRegisters({
      R0: 0,
      R1: SAMPLE_ASCII,
      R2: SAMPLE_KEYCODE,
      ...SAVED,
    });
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    mock.setPcKey(SAMPLE_ASCII, SAMPLE_KEYCODE);
    await callPcKey(mock);
    s.expectRegisters({ R0: 0, ...SAVED });
  });
});
