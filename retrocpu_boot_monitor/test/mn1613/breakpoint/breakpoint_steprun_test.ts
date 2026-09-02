/**
 * ステップ実行（18h / INT1_CAUSE=1 / CPLD 0036・0037）
 * 根拠: breakpoint.mdc「ステップ実行」/ HandShake.mdc 18h・1Bh /
 * MN1613_CPUボードメモリ_IOマップ.mdc（STEP_BRK_ENA / STEP_BRK_DELAY）
 */
import { stepBreak } from "../../../../retrocpu_emu_ts/src/cpuboard/mn1613/step_break.js";
import {
  getState,
  run,
  setState,
  triggerInterrupt,
} from "../../../../retrocpu_emu_ts/src/cpuboard/mn1613/mn1613.js";
import {
  createSessionFromSettings,
  expect,
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

const IDLE = 0x1b00;
const OP_H = 0x2000;
const STR_IRQ_ENABLE = 0x0700;
const STEP_DELAY = 0x01;
const IC_SAVE = 3;
const USER_IC = 0x1800;

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
 * IO が HSHK_IN_REQ を上げるまで待つ。
 * @param mock IO モック
 * @param timeoutMs 上限 ms
 */
async function waitReq1(
  mock: IoBoardHandshakeMock,
  timeoutMs = 2000,
): Promise<void> {
  const t0 = Date.now();
  while (mock.bus.HSHK_IN_REQ !== 1) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("timeout waiting HSHK_IN_REQ");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * ハンドシェイク IRQ ハンドラと IO→CPU 交換を並行する。
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
    registers: { ...BASE_REGS },
  });
  return io;
}

test("18h 方式 0 は OK で ARM を落とす（ENA は上げない）", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(s.wordAddr("GL_BP_STEP_ARM"), 1);
    const reply = await callHandler(mock, Uint8Array.from([0x18, 0]), 1);
    expect(Array.from(reply)).toEqual([0x00]);
    expect(s.readWord(s.wordAddr("GL_BP_STEP_ARM"))).toBe(0);
    expect(stepBreak.getEnable()).toBe(0);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });
  });
});

test("18h 方式 1 は ARM を立て、ENA はまだ 0", async () => {
  await withCase(async (s, mock) => {
    const reply = await callHandler(mock, Uint8Array.from([0x18, 1]), 1);
    expect(Array.from(reply)).toEqual([0x00]);
    expect(s.readWord(s.wordAddr("GL_BP_STEP_ARM"))).toBe(1);
    expect(stepBreak.getEnable()).toBe(0);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });
  });
});

test("18h 方式 2 は NG で ARM を変えない", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(s.wordAddr("GL_BP_STEP_ARM"), 0);
    const reply = await callHandler(mock, Uint8Array.from([0x18, 2]), 1);
    expect(Array.from(reply)).toEqual([0x01]);
    expect(s.readWord(s.wordAddr("GL_BP_STEP_ARM"))).toBe(0);
    expect(stepBreak.getEnable()).toBe(0);
    s.expectRegisters({ R0: 0, R4: BASE_REGS.R4 });
  });
});

test("g_step_arm_cpld は ARM=1 のとき 0037h=delay・0036h=1 にしてフラグを落とす", async () => {
  await withCase(async (s) => {
    stepBreak.writePort(0x37, 0x1111);
    s.writeWord(s.wordAddr("GL_BP_STEP_ARM"), 1);
    await s.call("g_step_arm_cpld", { registers: { ...BASE_REGS } });
    expect(stepBreak.getDelayCount()).toBe(STEP_DELAY);
    expect(stepBreak.getEnable()).toBe(1);
    expect(s.readWord(s.wordAddr("GL_BP_STEP_ARM"))).toBe(0);
  });
});

test("g_step_arm_cpld は ARM=0 なら DELAY/ENA を触らない", async () => {
  await withCase(async (s) => {
    stepBreak.writePort(0x36, 0);
    stepBreak.writePort(0x37, 0x1111);
    s.writeWord(s.wordAddr("GL_BP_STEP_ARM"), 0);
    await s.call("g_step_arm_cpld", { registers: { ...BASE_REGS } });
    expect(stepBreak.getDelayCount()).toBe(0x11);
    expect(stepBreak.getEnable()).toBe(0);
  });
});

test("INT1_CAUSE=1 の停止は 1Bh に監視 IC を載せ履歴は書かない", async () => {
  await withCase(async (s, mock) => {
    // 要因 INT1 / CAUSE=1 から 1Bh。開始 IC が通知アドレスになる。
    s.writeWord(USER_IC, OP_H);
    setState({
      STR: STR_IRQ_ENABLE,
      SP: 0xff00,
      CSBR: 0,
      SSBR: 0,
      IISR: 0,
    });
    mock.bus.INT_CAUSE = 1;
    triggerInterrupt(1);
    const [status] = await Promise.all([
      run(USER_IC, s.maxCycles),
      mock.handleOneRequest(),
    ]);
    expect(status).toBe("halted");
    expect(mock.state.lastBreakNotify).toBe(null);
    expect(mock.state.lastStepNotify?.addr).toBe(USER_IC);
    expect(mock.state.lastStepNotify?.ic).toBe(USER_IC);
    expect(mock.state.lastStepNotify?.stack?.length).toBe(16);
    expect(s.readWord(s.wordAddr("GL_BP_HIST_META"))).toBe(0);
  });
});

test("INT1 ステップで停止すると main_loop の H に入る", async () => {
  await withCase(async (s, mock) => {
    s.writeWord(IDLE, OP_H);
    s.writeWord(IC_SAVE, USER_IC);
    setState({
      STR: STR_IRQ_ENABLE,
      SP: 0xff00,
      CSBR: 0,
      SSBR: 0,
      IISR: 0,
    });
    mock.bus.INT_CAUSE = 1;
    triggerInterrupt(1);
    const [status] = await Promise.all([
      run(IDLE, s.maxCycles),
      mock.handleOneRequest(),
    ]);
    expect(status).toBe("halted");
    expect(mock.state.lastStepNotify?.addr).toBe(IDLE);
    expect(mock.state.lastStepNotify?.ic).toBe(IDLE);
    expect(mock.state.lastStepNotify?.stack?.length).toBe(16);
    const ic = getState().IC & 0xffff;
    expect(s.readWord((ic - 1) & 0xffff)).toBe(OP_H);
  });
});
