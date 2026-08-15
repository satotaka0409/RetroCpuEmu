/**
 * g_breakpoint_interrupt_handler（INT2 / INT_CAUSE=3 → 1Ah）
 * 根拠: HandShake.mdc「ブレイク通知」/ breakpoint.mdc /
 * MN1613_CPUボードメモリ_IOマップ.mdc（0033/0034）
 */
import {
  getState,
  run,
  setState,
  triggerInterrupt,
} from "../../../../retrocpu_emu/src/cpuboard/mn1613/mn1613.js";
import {
  createSessionFromSettings,
  expect,
  test,
  type IoBoardHandshakeMock,
  type JsonTestSettings,
  type Mn1613AsmSession,
} from "../../../../retrocpu_test_framework/src/index.js";
import {
  mn1613MonHandshakeSettings,
  withMn1613CpuLog,
} from "../mn1613_mon_settings.js";

const BASE_REGS = {
  R3: 0x3333,
  R4: 0x4444,
} as const;

const SLOT_WORDS = 6;
const IDLE = 0x1b00;
const OP_H = 0x2000;
const STR_IRQ_ENABLE = 0x0700;
const WATCH_WORD = 0x1800;
const WATCH_BYTE = 0x00003000;
const FLAGS_EQ = 0x08;
const FLAGS_WR = 0x04;
const FLAGS_RD = 0x02;
const FLAGS_HIST = 0x80;
/** HandShake.mdc flags Bit3–5: 0=なし 1:= 2:<> 3:>= 4:<= 5:AND<>0 6:AND=0 7=未定義 */
const BP_COND_EQ = 1;
const BP_COND_NE = 2;
const BP_COND_GE = 3;
const BP_COND_LE = 4;
const BP_COND_AND_NZ = 5;
const BP_COND_AND_Z = 6;
const BP_COND_UNDEF = 7;
const PREV_WR = 0xbeef;
const AFTER_WR = 0xcafe;
const HIST_SBR = 0x0c;
const HIST_LOG = 0xf000;
const HIST_ENTRY_WORDS = 33;
const HIST_SLOT_WORDS = 16 * HIST_ENTRY_WORDS;
const SAMPLE_TIME = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef] as const;
const SAMPLE_TIME_WORDS = [0x0123, 0x4567, 0x89ab, 0xcdef] as const;

/**
 * handshake + 0033/0034 ポート固定の設定を作る。
 * @param hit 0033 のヒット番号（0xFFFF は無効ヒット）
 * @param prev 0034 の前回書込値
 * @returns JsonTestSettings
 */
function settingsWithHit(hit: number, prev = 0): JsonTestSettings {
  return {
    ...mn1613MonHandshakeSettings,
    ioMock: [
      { type: "handshake", timeoutMs: 5000, syncIrq2: false },
      { type: "port", port: "0x33", read: hit },
      { type: "port", port: "0x34", read: prev },
    ],
  };
}

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

const sessionThru = createSessionFromSettings(
  withMn1613CpuLog(settingsWithHit(0xffff), import.meta.url),
);
const sessionSlot0 = createSessionFromSettings(
  withMn1613CpuLog(settingsWithHit(0), import.meta.url),
);
const sessionSlot6 = createSessionFromSettings(
  withMn1613CpuLog(settingsWithHit(6), import.meta.url),
);
const sessionPrev = createSessionFromSettings(
  withMn1613CpuLog(settingsWithHit(0, PREV_WR), import.meta.url),
);

/**
 * g_main 済みで 1 ケースを実行する。
 * @param session 対象セッション
 * @param fn 本体
 */
async function withCase(
  session: Mn1613AsmSession,
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

test("0033 が未マップならスルーして R0=0", async () => {
  await withCase(sessionThru, async (s) => {
    await s.call("g_breakpoint_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
  });
});

test("スロット 0 無効はスルー", async () => {
  await withCase(sessionSlot0, async (s) => {
    writeSlot(s, 0, [0, 0, 0, 0, WATCH_BYTE, 0]);
    await s.call("g_breakpoint_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
  });
});

test("スロット 0 有効・回数 0 は 1Ah を送り R0=1", async () => {
  await withCase(sessionSlot0, async (s, mock) => {
    writeSlot(s, 0, [1, 0, 0, 0, WATCH_BYTE, 0]);
    await Promise.all([
      s.call("g_breakpoint_interrupt_handler", {
        registers: { ...BASE_REGS },
      }),
      mock.handleOneRequest(),
    ]);
    s.expectRegisters({ R0: 1, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(mock.state.lastBreakNotify).toEqual({
      kind: 1,
      slot: 0,
      addr: WATCH_BYTE,
    });
  });
});

test("値比較不一致はスルー", async () => {
  await withCase(sessionSlot0, async (s) => {
    s.writeWord(WATCH_WORD, 0xaaaa);
    writeSlot(s, 0, [1, FLAGS_EQ, 0, 0, WATCH_BYTE, 0x1234]);
    await s.call("g_breakpoint_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
  });
});

test("回数 2 の 1 回目はデクリメントして継続", async () => {
  await withCase(sessionSlot0, async (s) => {
    writeSlot(s, 0, [1, 0, 2, 0, WATCH_BYTE, 0]);
    await s.call("g_breakpoint_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    const base = s.wordAddr("GL_HSHK_ADDR_BREAK");
    expect(s.readWord(base + 2)).toBe(1);
    expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
  });
});

test("スロット 6 もユーザ比較器として 1Ah", async () => {
  await withCase(sessionSlot6, async (s, mock) => {
    writeSlot(s, 6, [1, 0, 0, 0, WATCH_BYTE, 0]);
    await Promise.all([
      s.call("g_breakpoint_interrupt_handler", {
        registers: { ...BASE_REGS },
      }),
      mock.handleOneRequest(),
    ]);
    s.expectRegisters({ R0: 1, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(mock.state.lastBreakNotify).toEqual({
      kind: 1,
      slot: 6,
      addr: WATCH_BYTE,
    });
  });
});

test("履歴なし WRITE は継続しメタを触らない", async () => {
  await withCase(sessionPrev, async (s) => {
    writeSlot(s, 0, [1, FLAGS_WR, 2, 0, WATCH_BYTE, 0]);
    await s.call("g_breakpoint_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(0);
    expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
  });
});

test("Bit7 WRITE は 11h のあと 0034 と AFTER を 3F000h に書く", async () => {
  await withCase(sessionPrev, async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    s.writeWord(WATCH_WORD, AFTER_WR);
    writeSlot(s, 0, [1, FLAGS_WR | FLAGS_HIST, 2, 0, WATCH_BYTE, 0]);
    await Promise.all([
      s.call("g_breakpoint_interrupt_handler", {
        registers: { ...BASE_REGS },
      }),
      mock.handleOneRequest(),
    ]);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(1);
    const ent = histEntryPhys(0, 0);
    s.expectMemoryWords(ent, [...SAMPLE_TIME_WORDS, AFTER_WR, PREV_WR]);
    expect(s.readWord(ent + 9)).toBe(BASE_REGS.R3);
    expect(s.readWord(ent + 10)).toBe(BASE_REGS.R4);
    expect(mock.state.lastBreakNotify).toBe(null);
  });
});

test("Bit7 READ の PREV は 0000h（0034 は生値のまま）", async () => {
  await withCase(sessionPrev, async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    s.writeWord(WATCH_WORD, AFTER_WR);
    writeSlot(s, 0, [1, FLAGS_RD | FLAGS_HIST, 2, 0, WATCH_BYTE, 0]);
    await Promise.all([
      s.call("g_breakpoint_interrupt_handler", {
        registers: { ...BASE_REGS },
      }),
      mock.handleOneRequest(),
    ]);
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    const ent = histEntryPhys(0, 0);
    expect(s.readWord(ent + 4)).toBe(AFTER_WR);
    expect(s.readWord(ent + 5)).toBe(0);
    expect(s.readWord(ent + 9)).toBe(BASE_REGS.R3);
    expect(s.readWord(ent + 10)).toBe(BASE_REGS.R4);
  });
});

test("値比較不一致の Bit7 は履歴に書かない", async () => {
  await withCase(sessionPrev, async (s) => {
    s.writeWord(WATCH_WORD, 0xaaaa);
    writeSlot(s, 0, [1, FLAGS_EQ | FLAGS_HIST, 0, 0, WATCH_BYTE, 0x1234]);
    await s.call("g_breakpoint_interrupt_handler", {
      registers: { ...BASE_REGS },
    });
    s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(0);
    expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
  });
});

/**
 * 値比較条件を flags の Bit3–5 に載せる。
 * @param cond 0–7（breakpoint.asm の BP_COND_*）
 * @returns flags に OR するマスク
 */
function condFlags(cond: number): number {
  return (cond & 7) << 3;
}

/** MEM READ で条件不一致（または条件不正）になる組。GE/LE は符号付き 16bit。 */
const READ_MISMATCH: readonly {
  title: string;
  cond: number;
  access: number;
  data: number;
}[] = [
  { title: "=", cond: BP_COND_EQ, access: 0xaaaa, data: 0x1234 },
  { title: "<>", cond: BP_COND_NE, access: 0x1234, data: 0x1234 },
  { title: ">= 正", cond: BP_COND_GE, access: 0x0001, data: 0x0010 },
  { title: ">= 負", cond: BP_COND_GE, access: 0xfffe, data: 0xffff },
  { title: "<= 正", cond: BP_COND_LE, access: 0x0010, data: 0x0001 },
  { title: "<= 負", cond: BP_COND_LE, access: 0xffff, data: 0xfffe },
  { title: "AND<>0", cond: BP_COND_AND_NZ, access: 0x00ff, data: 0xff00 },
  { title: "AND=0", cond: BP_COND_AND_Z, access: 0x00f0, data: 0x00ff },
  { title: "未定義7", cond: BP_COND_UNDEF, access: 0x1234, data: 0x1234 },
];

for (const c of READ_MISMATCH) {
  test(`MEM READ 条件 ${c.title} 不一致はスルーして履歴に書かない`, async () => {
    await withCase(sessionPrev, async (s) => {
      s.writeWord(WATCH_WORD, c.access);
      writeSlot(s, 0, [
        1,
        FLAGS_RD | condFlags(c.cond) | FLAGS_HIST,
        0,
        0,
        WATCH_BYTE,
        c.data,
      ]);
      await s.call("g_breakpoint_interrupt_handler", {
        registers: { ...BASE_REGS },
      });
      s.expectRegisters({ R0: 0, R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
      expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(0);
      expect(s.requireHandshakeMock().state.lastBreakNotify).toBe(null);
    });
  });
}

test("INT2 要因3 で停止すると main_loop の H に入る", async () => {
  await withCase(sessionSlot0, async (s, mock) => {
    writeSlot(s, 0, [1, 0, 0, 0, WATCH_BYTE, 0]);
    s.writeWord(IDLE, OP_H);
    setState({
      STR: STR_IRQ_ENABLE,
      SP: 0xff00,
      CSBR: 0,
      SSBR: 0,
      IISR: 0,
    });
    mock.bus.INT_CAUSE = 3;
    triggerInterrupt(2);
    const [status] = await Promise.all([
      run(IDLE, s.maxCycles),
      mock.handleOneRequest(),
    ]);
    expect(status).toBe("halted");
    expect(mock.state.lastBreakNotify).toEqual({
      kind: 1,
      slot: 0,
      addr: WATCH_BYTE,
    });
    const ic = getState().IC & 0xffff;
    expect(s.readWord((ic - 1) & 0xffff)).toBe(OP_H);
  });
});
