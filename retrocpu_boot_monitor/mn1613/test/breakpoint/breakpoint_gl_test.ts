/**
 * 命令ブレイク結合（10h 設置 → 1Ah 停止通知 → 17h 状態/履歴 → 18h ステップ復帰）
 * 根拠: HandShake.mdc（10h / 1Ah / 17h / 18h / 1Bh）/ breakpoint.mdc /
 * MN1613_CPUボードメモリ_IOマップ.mdc（比較器 0030–0034、STEP 0036/0037）
 *
 * 10h は BIOS 表（GL_HSHK_ADDR_BREAK）へ書く。CPLD 比較器は BIOS が
 * 0030–0032 へまだ出さないため、テストが同じスロットへ MEM+READ を載せる。
 * 停止時の CPU 状態は廃止の 48h ではなく 17h 履歴エントリ（相対 0x0C 以降）。
 */
import {
  BREAK_RDWR_RD,
  addrComparators,
  encodeBreakCtrl,
  IO_PORT_BREAK_ADDR_HI,
  IO_PORT_BREAK_ADDR_LO,
  IO_PORT_BREAK_CTRL,
} from "../../../../retrocpu_emu/src/cpuboard/mn1613/addr_comparator.js";
import { stepBreak } from "../../../../retrocpu_emu/src/cpuboard/mn1613/step_break.js";
import {
  run,
  setState,
} from "../../../../retrocpu_emu/src/cpuboard/mn1613/mn1613.js";
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

/** ユーザ領域の監視ワードアドレス（CSBR=0） */
const WATCH_WORD = 0x1800;
/** 10h / 1Ah の監視アドレス（バイト、ビッグエンディアン） */
const WATCH_BYTE = WATCH_WORD * 2;
/** B $-1（フェッチ後 IC から -1 → 自分自身へ戻る） */
const OP_B_SELF = 0xcfff;
/** 命令ブレイク: MEM + RD_EN + INST */
const FLAGS_INST_RD = 0x42;
/** 命令ブレイク + 履歴 */
const FLAGS_INST_RD_HIST = 0xc2;
/** 履歴ヒット回数（10h の count。1 減らし 0 で停止） */
const HIST_COUNT = 4;
const SLOT_WORDS = 6;
const STR_IRQ_ENABLE = 0x0700;
const IDLE_SP = 0xff00;
const SAMPLE_TIME = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef] as const;
/** 17h: ヘッダ 8B ＋ エントリ 66B×件数 ＋ 終端 1B */
const HIST_ENTRY_BYTES = 66;
/** EOR R0,R0 */
const OP_EOR_R0 = 0x6000;
const L2_IC_SAVE = 5;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

/**
 * スロット 6 ワードを読む。
 * @param s セッション
 * @param slot 0–7
 * @returns [ena, flags, count, addrHi, addrLo, data]
 */
function readSlot(s: Mn1613AsmSession, slot: number): number[] {
  const base = s.wordAddr("GL_HSHK_ADDR_BREAK") + slot * SLOT_WORDS;
  return Array.from({ length: SLOT_WORDS }, (_, i) => s.readWord(base + i));
}

/**
 * 10h フレーム（cmd + slot + flags + count + addr32 BE + data16 BE）。
 * @param slot 設定番号 0–7
 * @param flags Bit0 MEM/IO, Bit1 RD, Bit2 WR, Bit6 INST, Bit7 履歴
 * @param count 0=即停止。1–255=その回数で停止
 * @param addr 監視バイトアドレス
 * @param data 比較データ（命令では無視）
 * @returns IO→CPU フレーム
 */
function breakSetFrame(
  slot: number,
  flags: number,
  count: number,
  addr: number,
  data: number,
): Uint8Array {
  const a = addr >>> 0;
  const d = data & 0xffff;
  return Uint8Array.from([
    0x10,
    slot & 0xff,
    flags & 0xff,
    count & 0xff,
    (a >>> 24) & 0xff,
    (a >>> 16) & 0xff,
    (a >>> 8) & 0xff,
    a & 0xff,
    (d >>> 8) & 0xff,
    d & 0xff,
  ]);
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
    registers: { ...BASE_REGS, STR: 0 },
  });
  return io;
}

/**
 * 10h と同じスロットへ CPLD 比較器（MEM READ）を載せる。
 * @param slot 0–7
 * @param wordAddr 監視する 18bit 物理ワードアドレス
 */
function armCpldFetchBreak(slot: number, wordAddr: number): void {
  addrComparators.writePort(IO_PORT_BREAK_ADDR_LO, wordAddr & 0xffff);
  addrComparators.writePort(IO_PORT_BREAK_ADDR_HI, (wordAddr >>> 16) & 0x03);
  addrComparators.writePort(
    IO_PORT_BREAK_CTRL,
    encodeBreakCtrl(slot, true, false, BREAK_RDWR_RD),
  );
}

/**
 * ビッグエンディアン 16bit をバッファから読む。
 * @param buf バイト列
 * @param off 先頭オフセット
 * @returns 16bit
 */
function be16(buf: Uint8Array, off: number): number {
  return ((buf[off]! << 8) | buf[off + 1]!) & 0xffff;
}

/**
 * 監視アドレスへ自己分岐を置き、INT2 許可で実行する。
 * @param s セッション
 */
function loadSelfLoop(s: Mn1613AsmSession): void {
  s.writeWord(WATCH_WORD, OP_B_SELF);
  setState({
    STR: STR_IRQ_ENABLE,
    SP: IDLE_SP,
    CSBR: 0,
    SSBR: 0,
    IISR: 0,
  });
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

test("命令ブレイク（通常）はフェッチで INT2 し 1Ah を送る", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(
      mock,
      breakSetFrame(0, FLAGS_INST_RD, 0, WATCH_BYTE, 0),
      1,
    );
    expect(Array.from(reply)).toEqual([0x00]);
    expect(readSlot(s, 0)).toEqual([
      1,
      FLAGS_INST_RD,
      0,
      (WATCH_BYTE >>> 16) & 0xffff,
      WATCH_BYTE & 0xffff,
      0,
    ]);

    armCpldFetchBreak(0, WATCH_WORD);
    loadSelfLoop(s);
    mock.start();
    try {
      const status = await run(WATCH_WORD, s.maxCycles);
      expect(status).toBe("halted");
    } finally {
      await mock.stop();
    }

    expect(mock.state.lastBreakNotify).toEqual({
      kind: 0,
      slot: 0,
      addr: WATCH_BYTE,
    });
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(0);
  });
});

test("命令ブレイク（回数4・履歴）は 4 件残して 1Ah する", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    const reply = await callHandler(
      mock,
      breakSetFrame(0, FLAGS_INST_RD_HIST, HIST_COUNT, WATCH_BYTE, 0),
      1,
    );
    expect(Array.from(reply)).toEqual([0x00]);
    expect(readSlot(s, 0)[1]).toBe(FLAGS_INST_RD_HIST);
    expect(readSlot(s, 0)[2]).toBe(HIST_COUNT);

    armCpldFetchBreak(0, WATCH_WORD);
    loadSelfLoop(s);
    mock.start();
    try {
      const status = await run(WATCH_WORD, s.maxCycles);
      expect(status).toBe("halted");
    } finally {
      await mock.stop();
    }

    expect(mock.state.lastBreakNotify).toEqual({
      kind: 0,
      slot: 0,
      addr: WATCH_BYTE,
    });
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(HIST_COUNT);
    addrComparators.writePort(
      IO_PORT_BREAK_CTRL,
      encodeBreakCtrl(0, false, false, BREAK_RDWR_RD),
    );
    const hist = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      8 + HIST_COUNT * HIST_ENTRY_BYTES + 1,
    );
    expect(hist.length).toBe(8 + HIST_COUNT * HIST_ENTRY_BYTES + 1);
    expect(hist[0]).toBe(HIST_COUNT);
    expect(hist[1]).toBe(0);
    expect(hist[2]).toBe(FLAGS_INST_RD_HIST);
    expect(hist[3]).toBe(0);
    expect(hist[4]).toBe(0);
    expect(hist[5]).toBe(0);
    expect(hist[6]).toBe((WATCH_BYTE >>> 8) & 0xff);
    expect(hist[7]).toBe(WATCH_BYTE & 0xff);
    expect(hist[hist.length - 1]).toBe(0x00);
    for (let i = 0; i < HIST_COUNT; i += 1) {
      const off = 8 + i * HIST_ENTRY_BYTES;
      expect(Array.from(hist.slice(off, off + 8))).toEqual([...SAMPLE_TIME]);
      expect((hist[off + 8]! << 8) | hist[off + 9]!).toBe(OP_B_SELF);
      expect((hist[off + 10]! << 8) | hist[off + 11]!).toBe(0);
    }
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(HIST_COUNT);
  });
});

test("10h 設置→1Ah 停止→17h 状態/履歴→18h ステップ復帰", async () => {
  await withCase(async (s, mock) => {
    mock.setTimestamp(Uint8Array.from(SAMPLE_TIME));
    const setReply = await callHandler(
      mock,
      breakSetFrame(0, FLAGS_INST_RD_HIST, 0, WATCH_BYTE, 0),
      1,
    );
    expect(Array.from(setReply)).toEqual([0x00]);
    expect(readSlot(s, 0)).toEqual([
      1,
      FLAGS_INST_RD_HIST,
      0,
      (WATCH_BYTE >>> 16) & 0xffff,
      WATCH_BYTE & 0xffff,
      0,
    ]);

    s.writeWord(WATCH_WORD, OP_EOR_R0);
    s.writeWord(WATCH_WORD + 1, 0x2000);
    setState({
      STR: STR_IRQ_ENABLE,
      SP: IDLE_SP,
      CSBR: 0,
      SSBR: 0,
      IISR: 0,
      R: {
        0: 0x1111,
        1: 0x1001,
        2: BASE_REGS.R2,
        3: BASE_REGS.R3,
        4: BASE_REGS.R4,
      },
    });
    armCpldFetchBreak(0, WATCH_WORD);
    mock.start();
    try {
      const status = await run(WATCH_WORD, s.maxCycles);
      expect(status).toBe("halted");
    } finally {
      await mock.stop();
    }

    expect(mock.state.lastBreakNotify).toEqual({
      kind: 0,
      slot: 0,
      addr: WATCH_BYTE,
    });
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(1);
    const userIc = s.readWord(L2_IC_SAVE);
    expect(userIc).toBe(WATCH_WORD + 1);

    addrComparators.writePort(
      IO_PORT_BREAK_CTRL,
      encodeBreakCtrl(0, false, false, BREAK_RDWR_RD),
    );

    const hist = await callHandler(
      mock,
      Uint8Array.from([0x17, 0x00, 0x00]),
      8 + HIST_ENTRY_BYTES + 1,
    );
    expect(hist.length).toBe(8 + HIST_ENTRY_BYTES + 1);
    expect(hist[0]).toBe(1);
    expect(hist[1]).toBe(0);
    expect(hist[2]).toBe(FLAGS_INST_RD_HIST);
    expect(hist[3]).toBe(0);
    expect(hist[4]).toBe(0);
    expect(hist[5]).toBe(0);
    expect(hist[6]).toBe((WATCH_BYTE >>> 8) & 0xff);
    expect(hist[7]).toBe(WATCH_BYTE & 0xff);
    expect(hist[hist.length - 1]).toBe(0x00);
    const ent = 8;
    expect(Array.from(hist.slice(ent, ent + 8))).toEqual([...SAMPLE_TIME]);
    expect(be16(hist, ent + 8)).toBe(OP_EOR_R0);
    expect(be16(hist, ent + 10)).toBe(0);
    expect(be16(hist, ent + 12)).toBe(0);
    expect(be16(hist, ent + 14)).toBe(0);
    expect(be16(hist, ent + 16)).toBe(0);
    expect(be16(hist, ent + 18)).toBe(BASE_REGS.R3);
    expect(be16(hist, ent + 20)).toBe((IDLE_SP - 8) & 0xffff);
    expect(be16(hist, ent + 22)).toBe(IDLE_SP);
    expect(be16(hist, ent + 26)).toBe(userIc);

    const resume = await callHandler(mock, Uint8Array.from([0x18, 1]), 1);
    expect(Array.from(resume)).toEqual([0x00]);
    expect(s.readWord(s.wordAddr("GL_STEP_ARM"))).toBe(1);
    expect(stepBreak.getEnable()).toBe(0);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });

    await s.call("g_step_arm_cpld", { registers: { ...BASE_REGS } });
    expect(stepBreak.getTriggerWord()).toBe(0x2006);
    expect(stepBreak.getEnable()).toBe(1);
    expect(s.readWord(s.wordAddr("GL_STEP_ARM"))).toBe(0);
  });
});
