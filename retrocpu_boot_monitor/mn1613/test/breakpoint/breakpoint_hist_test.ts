/**
 * g_bp_hist_append（比較器ヒット履歴の追記）
 * 根拠: HandShake.mdc 17h エントリ / breakpoint.mdc / boot_monitor.mdc
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

const SLOT_WORDS = 6;
const WATCH_WORD = 0x1800;
const WATCH_BYTE = 0x00003000;
const AFTER_WR = 0xcafe;
const PREV_WR = 0xbeef;
const KIND_MEM = 1;
const KIND_IO = 2;
const FLAGS_WR = 0x04;
const FLAGS_RD = 0x02;
const FLAGS_INST = 0x40;
const FLAGS_IO = 0x01;
const HIST_SBR = 0x0c;
const HIST_LOG = 0xf000;
const HIST_ENTRY_WORDS = 33;
const HIST_SLOT_WORDS = 16 * HIST_ENTRY_WORDS;
const HIST_DEPTH = 16;
const SAMPLE_TIME = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef] as const;
const SAMPLE_TIME_WORDS = [0x0123, 0x4567, 0x89ab, 0xcdef] as const;
const SNAP_R3 = 0x3333;
const SNAP_R4 = 0x4444;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

/**
 * 論理アドレスと SBR から 18bit 物理ワードアドレスを求める。
 * @param logAddr 論理ワードアドレス（16bit）
 * @param sbr セグメント（下位 4bit）
 * @returns 物理ワードアドレス
 */
function physWord(logAddr: number, sbr: number): number {
  return (((sbr & 0xf) << 14) + (logAddr & 0xffff)) & 0x3ffff;
}

/**
 * 履歴エントリ先頭の物理ワードアドレス。
 * @param slot ユーザ 0–7
 * @param index リング index 0–15
 * @returns 物理ワードアドレス
 */
function histEntryPhys(slot: number, index: number): number {
  return physWord(
    HIST_LOG + slot * HIST_SLOT_WORDS + index * HIST_ENTRY_WORDS,
    HIST_SBR,
  );
}

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
 * ユーザースロット表へ 6 ワードを書く。
 * @param s セッション
 * @param slot 0–7
 * @param words ena / flags / count / addr_hi / addr_lo / data
 */
function writeSlot(
  s: Mn1613AsmSession,
  slot: number,
  words: readonly [number, number, number, number, number, number],
): void {
  const base = s.wordAddr("GL_HSHK_ADDR_BREAK") + slot * SLOT_WORDS;
  for (let i = 0; i < SLOT_WORDS; i += 1) {
    s.writeWord(base + i, words[i]!);
  }
}

/**
 * 履歴追記が読む入口スナップを置く。
 * @param s セッション
 */
function writeSnap(s: Mn1613AsmSession): void {
  const r3 = s.wordAddr("GL_BP_SNAP_R3");
  s.writeWord(r3, SNAP_R3);
  s.writeWord(r3 + 1, SNAP_R4);
  const tsr = s.wordAddr("GL_BP_SNAP_TSR0");
  s.writeWord(tsr, 0);
  s.writeWord(tsr + 1, 0);
  s.writeWord(s.wordAddr("GL_BP_SNAP_SP"), 0);
}

/**
 * g_bp_hist_append を 11h 応答と並行して呼ぶ。
 * @param s セッション
 * @param mock IO モック
 * @param kind 1Ah 区分
 * @param slot 0–7
 */
async function appendOnce(
  s: Mn1613AsmSession,
  mock: IoBoardHandshakeMock,
  kind: number,
  slot: number,
): Promise<void> {
  const table = s.wordAddr("GL_HSHK_ADDR_BREAK") + slot * SLOT_WORDS;
  await Promise.all([
    s.call("g_bp_hist_append", {
      registers: { R2: kind, R3: slot, R4: table },
    }),
    mock.handleOneRequest(),
  ]);
}

test("WRITE は 11h 時刻と AFTER/PREV をスロット 0 の 3F000h に書く", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    writeSnap(s);
    s.writeWord(WATCH_WORD, AFTER_WR);
    s.writeWord(s.wordAddr("GL_BP_HIT_PREV"), PREV_WR);
    writeSlot(s, 0, [1, FLAGS_WR, 0, 0, WATCH_BYTE, 0]);
    await appendOnce(s, mock, KIND_MEM, 0);
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(1);
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META") + 1)).toBe(1);
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META") + 2)).toBe(0);
    const ent = histEntryPhys(0, 0);
    s.expectMemoryWords(ent, [...SAMPLE_TIME_WORDS, AFTER_WR, PREV_WR]);
    expect(s.readWord(ent + 9)).toBe(SNAP_R3);
    expect(s.readWord(ent + 10)).toBe(SNAP_R4);
    expect(s.readWord(ent + 11)).toBe(0);
    expect(s.readWord(ent + 17)).toBe(0);
    expect(s.readWord(ent + 32)).toBe(0);
    expect(mock.state.lastBreakNotify).toBe(null);
  });
});

test("スロット 7 は slot×528 先へ書く", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    writeSnap(s);
    s.writeWord(WATCH_WORD, AFTER_WR);
    s.writeWord(s.wordAddr("GL_BP_HIT_PREV"), PREV_WR);
    writeSlot(s, 7, [1, FLAGS_WR, 0, 0, WATCH_BYTE, 0]);
    await appendOnce(s, mock, KIND_MEM, 7);
    const meta = s.wordAddr("GL_BP_HIST_META") + 7 * 3;
    expect(s.readWord(meta)).toBe(1);
    expect(s.readWord(histEntryPhys(7, 0))).toBe(SAMPLE_TIME_WORDS[0]);
    s.expectMemoryWords(histEntryPhys(7, 0), [
      ...SAMPLE_TIME_WORDS,
      AFTER_WR,
      PREV_WR,
    ]);
  });
});

test("READ / 命令の PREV は 0000h", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    writeSnap(s);
    s.writeWord(WATCH_WORD, AFTER_WR);
    s.writeWord(s.wordAddr("GL_BP_HIT_PREV"), PREV_WR);
    writeSlot(s, 0, [1, FLAGS_RD | FLAGS_INST, 0, 0, WATCH_BYTE, 0]);
    await appendOnce(s, mock, 0, 0);
    const ent = histEntryPhys(0, 0);
    expect(s.readWord(ent + 4)).toBe(AFTER_WR);
    expect(s.readWord(ent + 5)).toBe(0);
  });
});

test("IO 区分の AFTER は 0", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    writeSnap(s);
    s.writeWord(WATCH_WORD, AFTER_WR);
    writeSlot(s, 0, [1, FLAGS_IO | FLAGS_WR, 0, 0, WATCH_BYTE, 0]);
    await appendOnce(s, mock, KIND_IO, 0);
    const ent = histEntryPhys(0, 0);
    expect(s.readWord(ent + 4)).toBe(0);
  });
});

test("17 件目は件数 16 のままオーバフローを立て、index 0 を上書きする", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    writeSnap(s);
    s.writeWord(WATCH_WORD, AFTER_WR);
    s.writeWord(s.wordAddr("GL_BP_HIT_PREV"), PREV_WR);
    writeSlot(s, 0, [1, FLAGS_WR, 0, 0, WATCH_BYTE, 0]);
    const meta = s.wordAddr("GL_BP_HIST_META");
    s.writeWord(meta, HIST_DEPTH);
    s.writeWord(meta + 1, 0);
    s.writeWord(meta + 2, 0);
    s.writeWord(histEntryPhys(0, 0), 0x1111);
    await appendOnce(s, mock, KIND_MEM, 0);
    expect(s.readWord(meta)).toBe(HIST_DEPTH);
    expect(s.readWord(meta + 1)).toBe(1);
    expect(s.readWord(meta + 2)).toBe(1);
    expect(s.readWord(histEntryPhys(0, 0))).toBe(SAMPLE_TIME_WORDS[0]);
  });
});

test("R2/R3/R4 は追記の前後で保たれる", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    writeSnap(s);
    s.writeWord(WATCH_WORD, AFTER_WR);
    writeSlot(s, 1, [1, FLAGS_RD, 0, 0, WATCH_BYTE, 0]);
    const table = s.wordAddr("GL_HSHK_ADDR_BREAK") + SLOT_WORDS;
    await appendOnce(s, mock, KIND_MEM, 1);
    s.expectRegisters({ R2: KIND_MEM, R3: 1, R4: table });
  });
});
