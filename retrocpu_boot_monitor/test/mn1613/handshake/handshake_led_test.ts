/**
 * g_bios_led_display / seven_seg / bullet（CPU→IO コマンド 16h）
 * 根拠: HandShake.mdc「LED表示依頼」/ boot_monitor.mdc / test_framework.mdc
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

/** ユーザ RAM 上の LED バッファ（ワードアドレス） */
const LED_BUF = 0x1800;

/** g_main が書く乱数種 */
const GL_RND_DEFAULT_SEED = 0x1234;

/** フリーモード（ハンドシェイク 10h の値） */
const MODE_FREE = 1;

/** ADDR 8 + DATA 4 の 7セグパターン（0–B、a–g ビット） */
const SEVEN_SEG = [
  0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c,
] as const;

/** seven_seg 上書き用（全桁 0x01） */
const SEVEN_SEG_ALT = [
  0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x11, 0x22, 0x44, 0x88,
] as const;

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
 * LED BIOS を呼び、CPU→IO 1 トランザクションと並行する。
 * @param mock IO モック
 * @param label 入口
 * @param registers R0/R1 など
 */
async function callLed(
  mock: IoBoardHandshakeMock,
  label: string,
  registers: { R0?: number; R1?: number },
): Promise<void> {
  await Promise.all([
    session.call(label, {
      registers: { ...BASE_REGS, ...registers },
    }),
    mock.handleOneRequest(),
  ]);
}

test("g_main 後、ラッチ 14 ワードは 0 で種は保たれる", async () => {
  await withCase(async (s) => {
    expect(s.readWord(s.wordAddr("GL_RND_SEED"))).toBe(GL_RND_DEFAULT_SEED);
    const latch = s.wordAddr("GL_HSHK_LED_LATCH");
    for (let i = 0; i < 14; i += 1) {
      expect(s.readWord(latch + i)).toBe(0);
    }
  });
});

test("display は 7seg×12 と砲弾 2B を IO へ届ける", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    writeByteWords(s, LED_BUF, [...SEVEN_SEG, 0xab, 0xcd]);
    await callLed(mock, "g_bios_led_display", { R0: LED_BUF });
    s.expectRegisters({ R0: 0 });
    expect(mock.state.led).toBeTruthy();
    expect(Array.from(mock.state.led!.sevenSeg)).toEqual([...SEVEN_SEG]);
    expect(mock.state.led!.bulletLed0_7).toBe(0xab);
    expect(mock.state.led!.bulletLed8_F).toBe(0xcd);
  });
});

test("モニターモードでは 01h を返し LED を更新しない", async () => {
  await withCase(async (s, mock) => {
    writeByteWords(s, LED_BUF, [...SEVEN_SEG, 0xab, 0xcd]);
    await callLed(mock, "g_bios_led_display", { R0: LED_BUF });
    s.expectRegisters({ R0: 1 });
    expect(mock.state.led).toBe(null);
  });
});

test("seven_seg R1=0 は砲弾を 0 で送る", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    writeByteWords(s, LED_BUF, [...SEVEN_SEG, 0xab, 0xcd]);
    await callLed(mock, "g_bios_led_display", { R0: LED_BUF });
    writeByteWords(s, LED_BUF, SEVEN_SEG_ALT);
    await callLed(mock, "g_bios_led_seven_seg", { R0: LED_BUF, R1: 0 });
    s.expectRegisters({ R0: 0 });
    expect(Array.from(mock.state.led!.sevenSeg)).toEqual([...SEVEN_SEG_ALT]);
    expect(mock.state.led!.bulletLed0_7).toBe(0);
    expect(mock.state.led!.bulletLed8_F).toBe(0);
  });
});

test("seven_seg R1=1 は砲弾ラッチを維持する", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    writeByteWords(s, LED_BUF, [...SEVEN_SEG, 0xab, 0xcd]);
    await callLed(mock, "g_bios_led_display", { R0: LED_BUF });
    writeByteWords(s, LED_BUF, SEVEN_SEG_ALT);
    await callLed(mock, "g_bios_led_seven_seg", { R0: LED_BUF, R1: 1 });
    s.expectRegisters({ R0: 0 });
    expect(Array.from(mock.state.led!.sevenSeg)).toEqual([...SEVEN_SEG_ALT]);
    expect(mock.state.led!.bulletLed0_7).toBe(0xab);
    expect(mock.state.led!.bulletLed8_F).toBe(0xcd);
  });
});

test("bullet は砲弾だけ更新し 7seg ラッチを維持する", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    writeByteWords(s, LED_BUF, [...SEVEN_SEG, 0xab, 0xcd]);
    await callLed(mock, "g_bios_led_display", { R0: LED_BUF });
    await callLed(mock, "g_bios_led_bullet", { R0: 0x12, R1: 0x34 });
    s.expectRegisters({ R0: 0 });
    expect(Array.from(mock.state.led!.sevenSeg)).toEqual([...SEVEN_SEG]);
    expect(mock.state.led!.bulletLed0_7).toBe(0x12);
    expect(mock.state.led!.bulletLed8_F).toBe(0x34);
  });
});

test("R3/R4 は呼び出しの前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    mock.state.mode = MODE_FREE;
    writeByteWords(s, LED_BUF, [...SEVEN_SEG, 0x55, 0xaa]);
    await callLed(mock, "g_bios_led_display", { R0: LED_BUF });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    await callLed(mock, "g_bios_led_seven_seg", { R0: LED_BUF, R1: 1 });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    await callLed(mock, "g_bios_led_bullet", { R0: 0x01, R1: 0x02 });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
