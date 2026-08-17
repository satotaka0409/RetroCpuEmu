/**
 * CPLD ステップ実行（IO:0036–0037）
 * 根拠: breakpoint.mdc「ステップ実行」（INT1・INT1_CAUSE=1）
 *
 * LPSW 2 の次の命令フェッチでワンショット。データ READ や 2 語目では発火しない。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  IO_PORT_STEP_COM,
  IO_PORT_STEP_ENA,
  STEP_BRK_COM_LPSW2,
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

/** IRQ1 のペンディングビット */
const IRQ1_BIT = 0x02;
/** EOR R0, R0 */
const OP_EOR_R0 = 0x6000;
/** H */
const OP_H = 0x2000;
/** MVWI R0, imm16 の第 1 語 */
const OP_MVWI_R0 = 0x7807;
/** LPSW 2 が読む STR / IC（ワード 4 / 5） */
const LPSW2_STR_ADDR = 4;
const LPSW2_IC_ADDR = 5;
/** 復帰先（ユーザ 1 命令） */
const USER_IC = 0x0010;
/** レベル1 ISR（NPP=1 → NPSW 0x0100、LL=1 は +2/+3） */
const L1_NPSW_STR = 0x0102;
const L1_NPSW_IC = 0x0103;
const L1_ISR_IC = 0x0108;

/**
 * メモリ先頭へワード列を載せ、IC=0 から実行できる状態にする。
 * @param words 機械語ワード列
 */
function loadProg(words: number[]): void {
  const view = new DataView(getMemory());
  for (let i = 0; i < words.length; i += 1) {
    view.setUint16(i * 2, words[i]! & 0xffff, false);
  }
  setState({ IC: 0 });
  startRun();
}

/**
 * プログラムを 1 命令ずつ実行する。
 * @param words 機械語
 * @param n 実行する命令数
 */
function runSteps(words: number[], n: number): void {
  loadProg(words);
  for (let i = 0; i < n; i += 1) {
    step();
  }
}

/**
 * `rd R0, port` を 1 命令実行して R0 を返す。
 * @param port IO ポート
 * @returns R0
 */
function rdPort(port: number): number {
  loadProg([0x1800 | (port & 0xff), OP_H]);
  step();
  return getState().R[0]! & 0xffff;
}

/**
 * `wt R0, port` で値を書く（直前に MVWI で R0 をセット）。
 * @param port IO ポート
 * @param val 16bit
 */
function wtPort(port: number, val: number): void {
  runSteps([OP_MVWI_R0, val & 0xffff, 0x1000 | (port & 0xff), OP_H], 3);
}

/**
 * LPSW 2 の退避スロットと復帰先を置く。
 * @param userOps 復帰先からの機械語
 * @param userStr 復帰 STR（既定 0）
 */
function placeLpsw2Target(userOps: number[], userStr = 0): void {
  const view = new DataView(getMemory());
  view.setUint16(LPSW2_STR_ADDR * 2, userStr & 0xffff, false);
  view.setUint16(LPSW2_IC_ADDR * 2, USER_IC, false);
  for (let i = 0; i < userOps.length; i += 1) {
    view.setUint16((USER_IC + i) * 2, userOps[i]! & 0xffff, false);
  }
}

describe("StepBreakUnit 状態機械", () => {
  let u: StepBreakUnit;
  let hits: number;

  beforeEach(() => {
    u = new StepBreakUnit();
    hits = 0;
    u.setOnHit(() => {
      hits += 1;
    });
  });

  it("reset 後は ENA=0・COM=LPSW2・idle", () => {
    u.writePort(IO_PORT_STEP_COM, 0x1111);
    u.writePort(IO_PORT_STEP_ENA, 1);
    u.onInstructionFetch(STEP_BRK_COM_LPSW2);
    u.reset();
    expect(u.getEnable()).toBe(0);
    expect(u.getTriggerWord()).toBe(STEP_BRK_COM_LPSW2);
    expect(u.getPhase()).toBe("idle");
    expect(u.readPort(IO_PORT_STEP_ENA)).toBe(0);
    expect(u.readPort(IO_PORT_STEP_COM)).toBe(STEP_BRK_COM_LPSW2);
    expect(u.readPort(0x30)).toBeNull();
  });

  it("ENA の Bit0 だけ有効。対象外ポートは false", () => {
    expect(u.writePort(0x0030, 1)).toBe(false);
    expect(u.writePort(IO_PORT_STEP_ENA, 0x00ff)).toBe(true);
    expect(u.getEnable()).toBe(1);
    u.writePort(IO_PORT_STEP_ENA, 0x00fe);
    expect(u.getEnable()).toBe(0);
  });

  it("トリガ語の次の命令フェッチで 1 回だけヒットし ENA が落ちる", () => {
    u.writePort(IO_PORT_STEP_COM, STEP_BRK_COM_LPSW2);
    u.writePort(IO_PORT_STEP_ENA, 1);
    u.onInstructionFetch(STEP_BRK_COM_LPSW2);
    expect(hits).toBe(0);
    expect(u.getPhase()).toBe("armed");
    u.onInstructionFetch(OP_EOR_R0);
    expect(hits).toBe(1);
    expect(u.getEnable()).toBe(0);
    expect(u.getPhase()).toBe("idle");
    u.onInstructionFetch(OP_H);
    expect(hits).toBe(1);
  });

  it("トリガ以外のフェッチでは武装しない", () => {
    u.writePort(IO_PORT_STEP_ENA, 1);
    u.onInstructionFetch(OP_EOR_R0);
    expect(u.getPhase()).toBe("idle");
    u.onInstructionFetch(OP_H);
    expect(hits).toBe(0);
  });

  it("武装中に ENA=0 すると解除されヒットしない", () => {
    u.writePort(IO_PORT_STEP_ENA, 1);
    u.onInstructionFetch(STEP_BRK_COM_LPSW2);
    expect(u.getPhase()).toBe("armed");
    u.writePort(IO_PORT_STEP_ENA, 0);
    expect(u.getPhase()).toBe("idle");
    u.onInstructionFetch(OP_EOR_R0);
    expect(hits).toBe(0);
  });
});

describe("ステップ実行 IO:0036–0037", () => {
  beforeEach(() => {
    setMemory(new ArrayBuffer(0x10000));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    attachHandshakeBus(null);
    attachIoBoardPorts();
    resetAddrComparators();
  });

  it("0036/0037 に書いた値を読み返せる", () => {
    wtPort(IO_PORT_STEP_COM, 0x1234);
    wtPort(IO_PORT_STEP_ENA, 1);
    expect(rdPort(IO_PORT_STEP_COM)).toBe(0x1234);
    expect(rdPort(IO_PORT_STEP_ENA)).toBe(1);
    expect(stepBreak.getTriggerWord()).toBe(0x1234);
    expect(stepBreak.getEnable()).toBe(1);
  });

  it("LPSW 2 の次の命令フェッチで INT1・INT1_CAUSE=1 が立ち ENA が落ちる", () => {
    placeLpsw2Target([OP_EOR_R0, OP_H]);
    wtPort(IO_PORT_STEP_COM, STEP_BRK_COM_LPSW2);
    wtPort(IO_PORT_STEP_ENA, 1);

    loadProg([STEP_BRK_COM_LPSW2, OP_H]);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);

    step();
    expect(getState().IC).toBe(USER_IC);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);
    expect(stepBreak.getPhase()).toBe("armed");
    expect(stepBreak.getEnable()).toBe(1);

    setState({ IC: USER_IC });
    startRun();
    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(rdPort(0x21)).toBe(INT_CAUSE_CODE.STEP);
    expect(rdPort(IO_PORT_STEP_ENA)).toBe(0);
    expect(stepBreak.getPhase()).toBe("idle");
  });

  it("ユーザ命令の実行後に M1 が立っていればレベル1 ISR へ入る", () => {
    const view = new DataView(getMemory());
    view.setUint16(L1_NPSW_STR * 2, 0, false);
    view.setUint16(L1_NPSW_IC * 2, L1_ISR_IC, false);
    view.setUint16(L1_ISR_IC * 2, OP_H, false);
    placeLpsw2Target([OP_EOR_R0, OP_H], STR_M1);
    wtPort(IO_PORT_STEP_COM, STEP_BRK_COM_LPSW2);
    wtPort(IO_PORT_STEP_ENA, 1);
    loadProg([STEP_BRK_COM_LPSW2, OP_H]);
    step();
    setState({ IC: USER_IC, STR: STR_M1 });
    startRun();
    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    step();
    expect(getState().IC).toBe(L1_ISR_IC + 1);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);
  });

  it("ENA=0 なら LPSW 2 を実行しても上がらない", () => {
    placeLpsw2Target([OP_EOR_R0, OP_H]);
    wtPort(IO_PORT_STEP_COM, STEP_BRK_COM_LPSW2);
    wtPort(IO_PORT_STEP_ENA, 0);
    loadProg([STEP_BRK_COM_LPSW2, OP_H]);
    step();
    setState({ IC: USER_IC });
    startRun();
    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);
  });

  it("メモリ READ でトリガ語が出ても武装しない", () => {
    const dataAddr = 0x0200;
    new DataView(getMemory()).setUint16(dataAddr * 2, STEP_BRK_COM_LPSW2, false);
    wtPort(IO_PORT_STEP_COM, STEP_BRK_COM_LPSW2);
    wtPort(IO_PORT_STEP_ENA, 1);
    runSteps([0x2708, dataAddr, OP_H], 1);
    expect(stepBreak.getPhase()).toBe("idle");
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);
    expect(rdPort(IO_PORT_STEP_ENA)).toBe(1);
  });

  it("2 語命令の第 2 語フェッチでは発火せず、次命令の先頭で発火する", () => {
    wtPort(IO_PORT_STEP_COM, OP_MVWI_R0);
    wtPort(IO_PORT_STEP_ENA, 1);
    loadProg([OP_MVWI_R0, 0x1234, OP_EOR_R0, OP_H]);

    step();
    expect(getState().R[0]).toBe(0x1234);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);
    expect(stepBreak.getPhase()).toBe("armed");

    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(rdPort(0x21)).toBe(INT_CAUSE_CODE.STEP);
    expect(rdPort(IO_PORT_STEP_ENA)).toBe(0);
  });

  it("ヒット後は再 ENABLE しない限り二度目は上がらない", () => {
    wtPort(IO_PORT_STEP_COM, OP_EOR_R0);
    wtPort(IO_PORT_STEP_ENA, 1);
    loadProg([OP_EOR_R0, OP_H, OP_EOR_R0, OP_H]);
    step();
    expect(stepBreak.getPhase()).toBe("armed");
    step();
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(stepBreak.getEnable()).toBe(0);
    const pending = getPendingIrq();
    step();
    expect(getPendingIrq()).toBe(pending);
    expect(stepBreak.getPhase()).toBe("idle");
  });
});
