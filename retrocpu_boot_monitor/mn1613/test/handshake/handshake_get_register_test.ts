/**
 * g_hshk_get_register（IO→CPU コマンド 48h）
 * 根拠: HandShake.mdc「CPU状態取得」/ boot_monitor.mdc / test_framework.mdc
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
  R4: 0x4444,
} as const;

/** ユーザ RAM 上の構造体先頭（ワードアドレス） */
const STRUCT_ADDR = 0x1800;

/** 48h 線上バイト数（11 ワード。HSHK_IRQ_STATUS_BYTES） */
const WIRE_BYTES = 0x16;

/** 構造体 11 ワード（R0…NPP|IISR） */
const SAMPLE_STRUCT = [
  0x1111, 0x1010, 0x2222, 0x3333, 0x4444, 0x5555, 0x00e0, 0xbeef, 0x0102,
  0x0304, 0x0a0b,
] as const;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

/**
 * 16bit をビッグエンディアン 2 バイトにする。
 * @param v 16bit 値
 * @returns [high, low]
 */
function be16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}

/**
 * 構造体 11 ワードを 48h 線上 0x16 バイトにする。
 * CSBR/SSBR・TSR0/TSR1・NPP/IISR は各 1 ワード（H/L）。
 * @param w R0…NPP|IISR
 * @returns ビッグエンディアン・バイト列
 */
function structToWire(w: readonly number[]): number[] {
  return w.flatMap((v) => be16(v));
}

/**
 * ユーザ RAM に構造体を書く。
 * @param s セッション
 * @param wordAddr 先頭ワードアドレス
 * @param words 11 ワード
 */
function writeStruct(
  s: Mn1613AsmSession,
  wordAddr: number,
  words: readonly number[],
): void {
  for (let i = 0; i < words.length; i += 1) {
    s.writeWord(wordAddr + i, words[i]!);
  }
}

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

test("R0 の構造体 11 ワードを 0x16 バイトで送る", async () => {
  await withCase(async (s, mock) => {
    writeStruct(s, STRUCT_ADDR, SAMPLE_STRUCT);
    const io = mock.exchangeWithCpu(
      Uint8Array.from([0x48]),
      WIRE_BYTES,
      Uint8Array.from([0x00]),
    );
    await waitReq1(mock);
    await s.call("g_hshk_accept_request", {
      registers: { ...BASE_REGS },
    });
    await s.call("g_hshk_recv_byte", {
      registers: { ...BASE_REGS },
    });
    await s.call("g_hshk_get_register", {
      registers: { ...BASE_REGS, R0: STRUCT_ADDR },
    });
    await s.call("g_hshk_finalize_recv", {
      registers: { ...BASE_REGS },
    });
    const reply = await io;
    const expected = structToWire(SAMPLE_STRUCT);
    expect(expected.length).toBe(WIRE_BYTES);
    expect(Array.from(reply)).toEqual(expected);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });
  });
});

test("R3/R4 は g_hshk_get_register の前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    writeStruct(s, STRUCT_ADDR, SAMPLE_STRUCT);
    const io = mock.exchangeWithCpu(
      Uint8Array.from([0x48]),
      WIRE_BYTES,
      Uint8Array.from([0x00]),
    );
    await waitReq1(mock);
    await s.call("g_hshk_accept_request", {
      registers: { ...BASE_REGS },
    });
    await s.call("g_hshk_recv_byte", {
      registers: { ...BASE_REGS },
    });
    await s.call("g_hshk_get_register", {
      registers: { ...BASE_REGS, R0: STRUCT_ADDR },
    });
    await s.call("g_hshk_finalize_recv", {
      registers: { ...BASE_REGS },
    });
    await io;
    s.expectRegisters({ R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});
