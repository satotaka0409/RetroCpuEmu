/**
 * CPLD ステップ実行（IO:0036–0037）
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc（STEP_BRK_ENA / STEP_BRK_DELAY）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  IO_PORT_STEP_DELAY,
  IO_PORT_STEP_ENA,
  STEP_BRK_DELAY_1STEP,
  StepBreakUnit,
  stepBreak,
} from "../../src/cpuboard/mn1613/step_break";
import {
  attachHandshakeBus,
  attachIoBoardPorts,
  resetAddrComparators,
} from "../../src/cpuboard/io_ports";
import { INT_CAUSE_CODE } from "../../src/shared/handshake/handshake_type";
import {
  STR_M1,
  getMemory,
  getPendingIrq,
  getState,
  powerOnIdle,
  setMemory,
  setPins,
  setState,
  startRun,
  step,
} from "../../src/cpuboard/mn1613/mn1613";

const IRQ1_BIT = 0x02;
const OP_EOR_R0 = 0x6000;
const OP_H = 0x2000;
const OP_MVWI_R0 = 0x7807;
const LPSW2_STR_ADDR = 4;
const LPSW2_IC_ADDR = 5;
const USER_IC = 0x0010;
const L1_NPSW_STR = 0x0102;
const L1_NPSW_IC = 0x0103;
const L1_ISR_IC = 0x0108;

function loadProg(words: number[]): void {
  const view = new DataView(getMemory());
  for (let i = 0; i < words.length; i += 1) {
    view.setUint16(i * 2, words[i]! & 0xffff, false);
  }
  setState({ IC: 0 });
  startRun();
}

function runSteps(words: number[], n: number): void {
  loadProg(words);
  for (let i = 0; i < n; i += 1) step();
}

function rdPort(port: number): number {
  loadProg([0x1800 | (port & 0xff), OP_H]);
  step();
  return getState().R[0]! & 0xffff;
}

function wtPort(port: number, val: number): void {
  runSteps([OP_MVWI_R0, val & 0xffff, 0x1000 | (port & 0xff), OP_H], 3);
}

function placeLpsw2Target(userOps: number[], userStr = 0): void {
  const view = new DataView(getMemory());
  view.setUint16(LPSW2_STR_ADDR * 2, userStr & 0xffff, false);
  view.setUint16(LPSW2_IC_ADDR * 2, USER_IC, false);
  for (let i = 0; i < userOps.length; i += 1) {
    view.setUint16((USER_IC + i) * 2, userOps[i]! & 0xffff, false);
  }
}

describe("StepBreakUnit 状態機械（DELAY）", () => {
  let u: StepBreakUnit;
  let hits: number;

  beforeEach(() => {
    u = new StepBreakUnit();
    hits = 0;
    u.setOnHit(() => {
      hits += 1;
    });
  });

  it("reset 後は ENA=0・DELAY=1・remaining=0", () => {
    u.writePort(IO_PORT_STEP_DELAY, 0x22);
    u.writePort(IO_PORT_STEP_ENA, 1);
    u.onInstructionFetch(OP_EOR_R0);
    u.reset();
    expect(u.getEnable()).toBe(0);
    expect(u.getDelayCount()).toBe(STEP_BRK_DELAY_1STEP);
    expect(u.getRemainingCount()).toBe(0);
    expect(u.readPort(IO_PORT_STEP_DELAY)).toBe(STEP_BRK_DELAY_1STEP);
    expect(u.readPort(IO_PORT_STEP_ENA)).toBe(0);
  });

  it("DELAY 書き込みは下位 8bit が保持される", () => {
    u.writePort(IO_PORT_STEP_DELAY, 0x1234);
    expect(u.getDelayCount()).toBe(0x34);
    expect(u.readPort(IO_PORT_STEP_DELAY)).toBe(0x34);
  });

  it("ENA=1 で DELAY を再ロードし、次フェッチからカウントを始める", () => {
    u.writePort(IO_PORT_STEP_DELAY, 1);
    u.writePort(IO_PORT_STEP_ENA, 1);
    expect(u.getEnable()).toBe(1);
    expect(u.getRemainingCount()).toBe(2);

    // 仕様: DELAY 書込直後の次クロックからカウント開始
    u.onInstructionFetch(OP_EOR_R0);
    expect(hits).toBe(0);
    expect(u.getRemainingCount()).toBe(2);

    u.onInstructionFetch(OP_H);
    expect(hits).toBe(0);
    expect(u.getRemainingCount()).toBe(1);

    u.onInstructionFetch(OP_EOR_R0);
    expect(hits).toBe(1);
    expect(u.getEnable()).toBe(0);
    expect(u.getRemainingCount()).toBe(0);
  });

  it("ENA=0 ではカウントせずヒットしない", () => {
    u.writePort(IO_PORT_STEP_DELAY, 1);
    u.writePort(IO_PORT_STEP_ENA, 0);
    u.onInstructionFetch(OP_EOR_R0);
    u.onInstructionFetch(OP_H);
    expect(hits).toBe(0);
  });

  it("武装中に ENA=0 でキャンセルされる", () => {
    u.writePort(IO_PORT_STEP_DELAY, 2);
    u.writePort(IO_PORT_STEP_ENA, 1);
    u.onInstructionFetch(OP_EOR_R0); // skip
    u.writePort(IO_PORT_STEP_ENA, 0);
    u.onInstructionFetch(OP_H);
    expect(hits).toBe(0);
    expect(u.getRemainingCount()).toBe(0);
  });
});

describe("ステップ実行 IO:0036–0037（DELAY）", () => {
  beforeEach(() => {
    setMemory(new ArrayBuffer(0x10000));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    attachHandshakeBus(null);
    attachIoBoardPorts();
    resetAddrComparators();
  });

  it("0036/0037 に書いた値を読み返せる", () => {
    wtPort(IO_PORT_STEP_DELAY, 3);
    wtPort(IO_PORT_STEP_ENA, 1);
    expect(rdPort(IO_PORT_STEP_DELAY)).toBe(3);
    expect(rdPort(IO_PORT_STEP_ENA)).toBe(1);
    expect(stepBreak.getDelayCount()).toBe(3);
    expect(stepBreak.getEnable()).toBe(1);
  });

  it("DELAY=1 で LPSW2 復帰後のユーザ1命令で INT1・CAUSE=STEP が立つ", () => {
    placeLpsw2Target([OP_EOR_R0, OP_H]);
    wtPort(IO_PORT_STEP_DELAY, STEP_BRK_DELAY_1STEP);
    wtPort(IO_PORT_STEP_ENA, 1);

    loadProg([0x2006, OP_H]); // LPSW 2, H
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);

    step(); // LPSW2
    expect(getState().IC).toBe(USER_IC);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);

    setState({ IC: USER_IC });
    startRun();
    step(); // user 1 instruction
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(rdPort(0x21)).toBe(INT_CAUSE_CODE.STEP);
    expect(rdPort(IO_PORT_STEP_ENA)).toBe(0);
  });

  it("ユーザ命令の実行後に M1 が立っていればレベル1 ISR へ入る", () => {
    const view = new DataView(getMemory());
    view.setUint16(L1_NPSW_STR * 2, 0, false);
    view.setUint16(L1_NPSW_IC * 2, L1_ISR_IC, false);
    view.setUint16(L1_ISR_IC * 2, OP_H, false);
    placeLpsw2Target([OP_EOR_R0, OP_H], STR_M1);

    wtPort(IO_PORT_STEP_DELAY, STEP_BRK_DELAY_1STEP);
    wtPort(IO_PORT_STEP_ENA, 1);
    loadProg([0x2006, OP_H]);
    step();

    setState({ IC: USER_IC, STR: STR_M1 });
    startRun();
    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    step();
    expect(getState().IC).toBe(L1_ISR_IC + 1);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);
  });

  it("再 ENABLE しない限り二度目は上がらない", () => {
    wtPort(IO_PORT_STEP_DELAY, STEP_BRK_DELAY_1STEP);
    wtPort(IO_PORT_STEP_ENA, 1);
    loadProg([OP_EOR_R0, OP_H, OP_EOR_R0, OP_H]);

    step(); // 1st fetch: skipFirstFetch を消化
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);

    step(); // 2nd/3rd fetch のどこかで IRQ 発火
    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(stepBreak.getEnable()).toBe(0);

    const pending = getPendingIrq();
    step();
    expect(getPendingIrq()).toBe(pending);
  });
});
