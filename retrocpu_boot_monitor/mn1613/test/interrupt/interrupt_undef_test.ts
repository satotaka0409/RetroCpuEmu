/**
 * INT0（未定義命令）→ GL_UNDEF_INST_REG 退避
 * 根拠: MN1613.mdc「未定義命令」/ 17h 履歴と同じレジスタ並び /
 * interrupt.asm g_int0_handler / asm_test_framework.mdc
 */
import {
  getState,
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

/** ユーザ RAM 上の未定義命令置き場（論理ワード。実行時 CSBR=PRE_CSBR） */
const UNDEF_WORD_ADDR = 0x1800;

/**
 * 論理アドレスと SBR から 18bit 物理ワードアドレスを求める。
 * @param logAddr 論理ワードアドレス（16bit）
 * @param sbr セグメント（下位 4bit）
 * @returns 物理ワードアドレス
 */
function physWord(logAddr: number, sbr: number): number {
  return (((sbr & 0xf) << 14) + (logAddr & 0xffff)) & 0x3ffff;
}

/** 未定義命令語（op=0x00） */
const UNDEF_OPCODE = 0x0000;

/** 割り込み直前に載せる汎用レジスタ */
const PRE_R = [0x1111, 0x2222, 0x3333, 0x4444, 0x5555] as const;

/** 割り込み直前の SP（空きスロット） */
const PRE_SP = 0xff00;

/** 割り込み直前の STR（M0|M1|M2 付きの識別値） */
const PRE_STR = 0x0700;

/**
 * セグメント類（下位 4bit）。
 * SSBR は 0 固定: PSHM は SSBR、ハンドラの `L n(X0)` は CSBR（割り込み後 0）なので
 * スタック読みと一致させる。
 */
const PRE_CSBR = 0x4;
const PRE_SSBR = 0x0;
const PRE_TSR0 = 0xc;
const PRE_TSR1 = 0x4;
const PRE_NPP = 0x01;

/** HSHK_REG_WORDS（GL_UNDEF_INST_REG / 17h 履歴と同じ 11 ワード） */
const HSHK_REG_WORDS = 11;

const session: Mn1613AsmSession = createSessionFromSettings(
  withMn1613CpuLog(mn1613MonHandshakeSettings, import.meta.url),
);

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
 * HandShake の H/L 1 バイトずつを 1 ワードに詰める。
 * @param hi 上位バイト
 * @param lo 下位バイト
 * @returns (hi<<8)|lo
 */
function packHL(hi: number, lo: number): number {
  return ((hi & 0xff) << 8) | (lo & 0xff);
}

/**
 * 未定義命令を実行し、INT0 が 13h と退避を終えて main_loop で HALT するまで待つ。
 * @param s セッション
 * @param mock IO モック（13h 応答）
 */
async function runUndefUntilMainLoop(
  s: Mn1613AsmSession,
  mock: IoBoardHandshakeMock,
): Promise<void> {
  s.writeWord(physWord(UNDEF_WORD_ADDR, PRE_CSBR), UNDEF_OPCODE);
  setState({
    R: [...PRE_R],
    SP: PRE_SP,
    STR: PRE_STR,
    CSBR: PRE_CSBR,
    SSBR: PRE_SSBR,
    TSR0: PRE_TSR0,
    TSR1: PRE_TSR1,
    NPP: PRE_NPP,
    IISR: 0,
  });

  const [status] = await Promise.all([
    run(UNDEF_WORD_ADDR, s.maxCycles),
    mock.handleOneRequest(),
  ]);
  expect(status).toBe("halted");
}

test("未定義命令で INT0 が掛かり IISR bit15 が立つ", async () => {
  await withCase(async (s, mock) => {
    await runUndefUntilMainLoop(s, mock);
    const st = getState();
    expect(st.IISR & 0x8000).toBe(0x8000);
    expect(mock.state.undefLed).toBe(true);
    // g_main_loop の H 実行後 IC はその次（H=0x2000）
    const ic = st.IC & 0xffff;
    expect(s.readWord((ic - 1) & 0xffff)).toBe(0x2000);
  });
});

test("GL_UNDEF_INST_REG に割り込み直前のレジスタが退避される", async () => {
  await withCase(async (s, mock) => {
    await runUndefUntilMainLoop(s, mock);

    // OPSW: *0=旧 STR、*1=未定義フェッチ後 IC（UNDEF+1）
    expect(s.readWord(0)).toBe(PRE_STR);
    expect(s.readWord(1)).toBe((UNDEF_WORD_ADDR + 1) & 0xffff);

    const expected = [
      PRE_R[0],
      PRE_R[1],
      PRE_R[2],
      PRE_R[3],
      PRE_R[4],
      PRE_SP,
      PRE_STR,
      (UNDEF_WORD_ADDR + 1) & 0xffff,
      packHL(PRE_CSBR, PRE_SSBR),
      packHL(PRE_TSR0, PRE_TSR1),
      (PRE_NPP & 0xff) << 8,
    ];
    expect(expected.length).toBe(HSHK_REG_WORDS);
    s.expectLabelWords("GL_UNDEF_INST_REG", expected);
  });
});
