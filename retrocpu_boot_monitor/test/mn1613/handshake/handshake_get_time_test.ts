/**
 * g_hshk_get_time（CPU→IO コマンド 11h）
 * 根拠: HandShake.mdc / boot_monitor.mdc / test_framework.mdc
 */
import {
  createSessionFromSettings,
  test,
  type IoBoardHandshakeMock,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework_ts/src/index.js";
import {
  mn1613MonHandshakeSettings,
  withMn1613CpuLog,
} from "../mn1613_mon_settings.js";

const BASE_REGS = {
  R2: 0x2222,
  R3: 0x3333,
  R4: 0x4444,
} as const;

/** 64bit 時刻（上位バイトが index 0 = 時刻7） */
const SAMPLE_TIME = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef] as const;

/** スタック 4 ワード（ビッグエンディアン、時刻7:6 … 時刻1:0） */
const SAMPLE_WORDS = [0x0123, 0x4567, 0x89ab, 0xcdef] as const;

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

test("11h で 64bit 時刻がスタック 4 ワードに格納される", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    await Promise.all([
      s.call("g_hshk_get_time", {
        registers: { ...BASE_REGS },
        stack: [0, 0, 0, 0],
      }),
      mock.handleOneRequest(),
    ]);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    s.expectStackWork({
      from: "preCallSp",
      offset: 2,
      words: [...SAMPLE_WORDS],
    });
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    await Promise.all([
      s.call("g_hshk_get_time", {
        registers: { ...BASE_REGS },
        stack: [0, 0, 0, 0],
      }),
      mock.handleOneRequest(),
    ]);
    s.expectRegisters({
      R0: 0,
      R3: 0x3333,
      R4: 0x4444,
    });
  });
});
