/**
 * interrupt.asm: g_int_init / g_set_int_adr / INT1–3 配送
 * 根拠: interrupt.asm / MN1613.mdc（BALR/RETL・LPSW）/ asm_test_framework.mdc
 */
import {
  run,
  setState,
  triggerInterrupt,
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

/** 登録ハンドラ先頭（ユーザ RAM・セグメント 0） */
const HANDLER0 = 0x1900;

/** 第2スロット用ハンドラ */
const HANDLER1 = 0x1910;

/** カウンタ（HANDLER0 が +1） */
const COUNTER0 = 0x1a00;

/** カウンタ（HANDLER1 が +1） */
const COUNTER1 = 0x1a01;

/** 割り込み復帰先（H） */
const IDLE = 0x1800;

/** H 命令 */
const OP_H = 0x2000;

/** RETL */
const OP_RETL = 0x3f07;

/**
 * `mvwi X0, #addr` / `l R0, 0(X0)` / `ai R0, #1` / `st R0, 0(X0)` / `retl`
 * （retrocpu_asm で組んだ固定語。カウンタ addr のみ差し替え）
 */
const INC_STUB_PREFIX = [0x7b07] as const;

const BASE_REGS = {
  R3: 0x3333,
  R4: 0x4444,
} as const;

/** 割り込み許可（M0|M1|M2） */
const STR_IRQ_ENABLE = 0x0700;

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
 * カウンタを +1 して RETL するスタブを書く（BALR 用）。
 * @param s セッション
 * @param at 配置ワードアドレス
 * @param counter カウンタワードアドレス
 */
function writeIncRetlStub(
  s: Mn1613AsmSession,
  at: number,
  counter: number,
): void {
  s.writeWord(at, INC_STUB_PREFIX[0]!);
  s.writeWord(at + 1, counter & 0xffff);
  s.writeWord(at + 2, 0xe000); // l R0, 0(X0)
  s.writeWord(at + 3, 0x4801); // ai R0, #1
  s.writeWord(at + 4, 0xa000); // st R0, 0(X0)
  s.writeWord(at + 5, OP_RETL);
}

/**
 * g_set_int_adr を呼ぶ。
 * @param slot 0–7（INT0-0 … INT3-1）
 * @param upperBits17_16 物理アドレス bit16–17（0–3）。asm 側で <<2 して CSBR 化
 * @param lowAddr 論理ワードアドレス
 */
async function setIntAdr(
  slot: number,
  upperBits17_16: number,
  lowAddr: number,
): Promise<void> {
  await session.call("g_set_int_adr", {
    registers: {
      R0: slot,
      R1: upperBits17_16,
      R2: lowAddr,
      R3: BASE_REGS.R3,
      R4: BASE_REGS.R4,
    },
  });
}

/**
 * レベル lv の割り込みを起こし、IDLE の H で止まるまで実行する。
 * @param s セッション
 * @param mock handshake モック（INT_CAUSE は mock.bus へ書く）
 * @param level 0–2
 * @param cause INT_CAUSE（INT2 用。他レベルでは無視されうる）
 */
async function raiseAndRunToIdle(
  s: Mn1613AsmSession,
  mock: IoBoardHandshakeMock,
  level: 0 | 1 | 2,
  cause?: number,
): Promise<void> {
  s.writeWord(IDLE, OP_H);
  s.writeWord(COUNTER0, 0);
  s.writeWord(COUNTER1, 0);
  setState({
    STR: STR_IRQ_ENABLE,
    SP: 0xff00,
    CSBR: 0,
    SSBR: 0,
    IISR: 0,
  });
  if (cause !== undefined) {
    mock.bus.INT_CAUSE = (cause & 0x07) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  }
  triggerInterrupt(level);
  const status = await run(IDLE, s.maxCycles);
  expect(status).toBe("halted");
}

test("g_main 後のベクタ表は 16 ワードすべて 0", async () => {
  await withCase(async (s) => {
    const zeros = Array.from({ length: 16 }, () => 0);
    s.expectLabelWords("GL_INT0_ADR", zeros);
  });
});

test("g_set_int_adr はスロットへ CSBR 形と論理アドレスを書く", async () => {
  await withCase(async (s) => {
    // slot 3 = INT1-1 → オフセット 3*2=6 ワード（GL_INT0_ADR 基準）
    await setIntAdr(3, 1, 0x2345); // bit16-17=1 → CSBR=4
    const base = s.wordAddr("GL_INT0_ADR");
    expect(s.readWord(base + 6)).toBe(0x0004);
    expect(s.readWord(base + 7)).toBe(0x2345);
    s.expectRegisters({ R3: BASE_REGS.R3, R4: BASE_REGS.R4 });
  });
});

test("g_set_int_adr で R1=R2=0 ならスロットをクリアする", async () => {
  await withCase(async (s) => {
    await setIntAdr(0, 0, 0x1111);
    await setIntAdr(0, 0, 0);
    s.expectLabelWords("GL_INT0_ADR", [0, 0]);
  });
});

test("INT1 で登録ハンドラが BALR されカウンタが増える", async () => {
  await withCase(async (s, mock) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    await setIntAdr(2, 0, HANDLER0); // INT1-0
    await raiseAndRunToIdle(s, mock, 1);
    expect(s.readWord(COUNTER0)).toBe(1);
    expect(s.readWord(COUNTER1)).toBe(0);
  });
});

test("INT1 の 2 スロットとも呼ばれる", async () => {
  await withCase(async (s, mock) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    writeIncRetlStub(s, HANDLER1, COUNTER1);
    await setIntAdr(2, 0, HANDLER0);
    await setIntAdr(3, 0, HANDLER1);
    await raiseAndRunToIdle(s, mock, 1);
    expect(s.readWord(COUNTER0)).toBe(1);
    expect(s.readWord(COUNTER1)).toBe(1);
  });
});

test("INT2 要因0はタイマー0スロットだけ呼ぶ", async () => {
  await withCase(async (s, mock) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    writeIncRetlStub(s, HANDLER1, COUNTER1);
    await setIntAdr(4, 0, HANDLER0); // INT2-0 = timer0
    await setIntAdr(5, 0, HANDLER1); // INT2-1 = timer1
    await raiseAndRunToIdle(s, mock, 2, 0);
    expect(s.readWord(COUNTER0)).toBe(1);
    expect(s.readWord(COUNTER1)).toBe(0);
  });
});

test("INT2 要因1はタイマー1スロットだけ呼ぶ", async () => {
  await withCase(async (s, mock) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    writeIncRetlStub(s, HANDLER1, COUNTER1);
    await setIntAdr(4, 0, HANDLER0);
    await setIntAdr(5, 0, HANDLER1);
    await raiseAndRunToIdle(s, mock, 2, 1);
    expect(s.readWord(COUNTER0)).toBe(0);
    expect(s.readWord(COUNTER1)).toBe(1);
  });
});

test("INT2 要因3（アドレスブレイク等）はタイマー登録を呼ばない", async () => {
  await withCase(async (s, mock) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    writeIncRetlStub(s, HANDLER1, COUNTER1);
    await setIntAdr(4, 0, HANDLER0);
    await setIntAdr(5, 0, HANDLER1);
    await raiseAndRunToIdle(s, mock, 2, 3);
    expect(s.readWord(COUNTER0)).toBe(0);
    expect(s.readWord(COUNTER1)).toBe(0);
  });
});

test("INT3 ハンドラは登録スロットを BALR して LPSW 3 で戻る", async () => {
  await withCase(async (s) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    await setIntAdr(6, 0, HANDLER0); // INT3-0
    s.writeWord(IDLE, OP_H);
    s.writeWord(COUNTER0, 0);
    // ソフトウェア割り込み相当: OPSW(6/7) を手で置き、入口へ run
    s.writeWord(6, STR_IRQ_ENABLE);
    s.writeWord(7, IDLE);
    setState({
      STR: STR_IRQ_ENABLE,
      SP: 0xff00,
      CSBR: 0,
      SSBR: 0,
      OSR: [0, 0, 0, 0],
      IISR: 0,
    });
    const status = await run(s.wordAddr("g_int3_handler"), s.maxCycles);
    expect(status).toBe("halted");
    expect(s.readWord(COUNTER0)).toBe(1);
  });
});

test("INT0（IISR bit15=0）は通常スロットを呼ぶ", async () => {
  await withCase(async (s, mock) => {
    writeIncRetlStub(s, HANDLER0, COUNTER0);
    await setIntAdr(0, 0, HANDLER0);
    await raiseAndRunToIdle(s, mock, 0);
    expect(s.readWord(COUNTER0)).toBe(1);
  });
});
