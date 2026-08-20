/**
 * センサー生値取得（CPU→IO コマンド 1Ch-1Fh）
 * 根拠: HandShake.mdc / boot_monitor.mdc / test_framework.mdc
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

/** RTC 生値 7 バイト */
const RTC_SAMPLE = [0x56, 0x34, 0x12, 0x09, 0x04, 0x08, 0x26] as const;

/** 温度生値 (MCP9808 Reg05h 相当) */
const TEMP_SAMPLE = 0x1a2b;

/** 光センサー生値 (TCS34725 RGBC) */
const LIGHT_SAMPLE = {
  clear: 0x1234,
  red: 0x5678,
  green: 0x9abc,
  blue: 0xdef0,
} as const;

/** 距離センサー生値 */
const DIST_SAMPLE = {
  distanceMm: 0x3456,
  rangeStatus: 0x1d,
} as const;

/**
 * g_main 済み＋ handshake モックで 1 ケースを実行する。
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
 * 1Ch RTC 生値取得を呼ぶ。
 * @param mock IO モック
 * @param dstWordAddr 結果バッファ先頭（7 ワード）
 */
async function callRtcRaw(
  mock: IoBoardHandshakeMock,
  dstWordAddr: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_rtc_get_raw", {
      registers: { ...BASE_REGS, R0: dstWordAddr },
    }),
    mock.handleOneRequest(),
  ]);
}

/**
 * 1Dh 温度生値取得を呼ぶ。
 * @param mock IO モック
 */
async function callTempRaw(mock: IoBoardHandshakeMock): Promise<void> {
  await Promise.all([
    session.call("g_bios_temp_get_raw", {
      registers: { ...BASE_REGS },
    }),
    mock.handleOneRequest(),
  ]);
}

/**
 * 1Eh 光センサー生値取得を呼ぶ。
 * @param mock IO モック
 * @param dstWordAddr 結果バッファ先頭（4 ワード）
 */
async function callLightRaw(
  mock: IoBoardHandshakeMock,
  dstWordAddr: number,
): Promise<void> {
  await Promise.all([
    session.call("g_bios_light_get_raw", {
      registers: { ...BASE_REGS, R0: dstWordAddr },
    }),
    mock.handleOneRequest(),
  ]);
}

/**
 * 1Fh 距離生値取得を呼ぶ。
 * @param mock IO モック
 */
async function callDistanceRaw(mock: IoBoardHandshakeMock): Promise<void> {
  await Promise.all([
    session.call("g_bios_distance_get_raw", {
      registers: { ...BASE_REGS },
    }),
    mock.handleOneRequest(),
  ]);
}

test("1Ch は RTC 生値 7B をバッファへ返す", async () => {
  await withCase(async (s, mock) => {
    const dst = 0x7000;
    for (let i = 0; i < 7; i += 1) {
      s.writeWord(dst + i, 0xffff);
    }
    mock.state.rtcRaw = Uint8Array.from(RTC_SAMPLE);

    await callRtcRaw(mock, dst);

    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    for (let i = 0; i < 7; i += 1) {
      expect(s.readWord(dst + i)).toBe(RTC_SAMPLE[i]);
    }
  });
});

test("1Dh は温度生値16bitを R1 で返す", async () => {
  await withCase(async (s, mock) => {
    mock.state.tempRaw = TEMP_SAMPLE;

    await callTempRaw(mock);

    s.expectRegisters({
      R0: 0,
      R1: TEMP_SAMPLE,
      R3: BASE_REGS.R3,
      R4: BASE_REGS.R4,
    });
  });
});

test("1Eh は光センサー RGBC を 4 ワードで返す", async () => {
  await withCase(async (s, mock) => {
    const dst = 0x7010;
    for (let i = 0; i < 4; i += 1) {
      s.writeWord(dst + i, 0);
    }
    mock.state.lightRaw = { ...LIGHT_SAMPLE };

    await callLightRaw(mock, dst);

    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.readWord(dst + 0)).toBe(LIGHT_SAMPLE.clear);
    expect(s.readWord(dst + 1)).toBe(LIGHT_SAMPLE.red);
    expect(s.readWord(dst + 2)).toBe(LIGHT_SAMPLE.green);
    expect(s.readWord(dst + 3)).toBe(LIGHT_SAMPLE.blue);
  });
});

test("1Fh は距離16bitと rangeStatus を返す", async () => {
  await withCase(async (s, mock) => {
    mock.state.distanceRaw = { ...DIST_SAMPLE };

    await callDistanceRaw(mock);

    s.expectRegisters({
      R0: 0,
      R1: DIST_SAMPLE.distanceMm,
      R2: DIST_SAMPLE.rangeStatus,
      R3: BASE_REGS.R3,
      R4: BASE_REGS.R4,
    });
  });
});
