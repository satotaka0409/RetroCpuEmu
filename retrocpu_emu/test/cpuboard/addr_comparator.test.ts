/**
 * CPLD アドレス比較器（IO:0030–0034）
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc / HandShake.mdc（INT1_CAUSE=0）
 *
 * 設定・読取と、一致時の INT1・INT1_CAUSE=0・0034 前回書込値を確認する。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  BREAK_RDWR_BOTH,
  BREAK_RDWR_RD,
  BREAK_RDWR_WR,
  encodeBreakCtrl,
  IO_PORT_BREAK_ADDR_HI,
  IO_PORT_BREAK_ADDR_LO,
  IO_PORT_BREAK_CTRL,
  IO_PORT_BREAK_HIT,
  IO_PORT_BREAK_PREV,
  addrComparators,
} from "../../src/cpuboard/mn1613/addr_comparator";
import {
  attachHandshakeBus,
  attachIoBoardPorts,
  resetAddrComparators,
} from "../../src/cpuboard/io_ports";
import { INT_CAUSE_CODE } from "../../src/shared/handshake/handshake_type";
import {
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
 * @param steps 実行する命令数
 */
function runSteps(words: number[], steps: number): void {
  loadProg(words);
  for (let i = 0; i < steps; i += 1) {
    step();
  }
}

/**
 * `rd R0, port` を 1 命令実行して R0 を返す。
 * @param port IO ポート
 * @returns R0
 */
function rdPort(port: number): number {
  loadProg([0x1800 | (port & 0xff), 0x2000]);
  step();
  return getState().R[0]! & 0xffff;
}

/**
 * `wt R0, port` で値を書く（直前に MVWI で R0 をセット）。
 * @param port IO ポート
 * @param val 16bit
 */
function wtPort(port: number, val: number): void {
  runSteps([0x7807, val & 0xffff, 0x1000 | (port & 0xff), 0x2000], 3);
}

describe("アドレス比較器 IO:0030–0034", () => {
  beforeEach(() => {
    setMemory(new ArrayBuffer(0x10000));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    attachHandshakeBus(null);
    attachIoBoardPorts();
    resetAddrComparators();
  });

  it("0030–0032 で設定した内容を読み返せる", () => {
    const addr = 0x12345;
    const ctrl = encodeBreakCtrl(3, true, false, BREAK_RDWR_BOTH);
    wtPort(IO_PORT_BREAK_ADDR_LO, addr & 0xffff);
    wtPort(IO_PORT_BREAK_ADDR_HI, (addr >>> 16) & 0x03);
    wtPort(IO_PORT_BREAK_CTRL, ctrl);

    expect(rdPort(IO_PORT_BREAK_CTRL)).toBe(ctrl);
    expect(rdPort(IO_PORT_BREAK_ADDR_LO)).toBe(addr & 0xffff);
    expect(rdPort(IO_PORT_BREAK_ADDR_HI)).toBe((addr >>> 16) & 0x03);
    expect(addrComparators.getSlot(3)?.enabled).toBe(true);
    expect(addrComparators.getSlot(3)?.addr).toBe(addr & 0x3ffff);
  });

  it("MEM READ 一致で INT1・INT1_CAUSE=0・ヒット番号が立つ", () => {
    const watch = 0x0200;
    new DataView(getMemory()).setUint16(watch * 2, 0xbeef, false);

    wtPort(IO_PORT_BREAK_ADDR_LO, watch);
    wtPort(IO_PORT_BREAK_ADDR_HI, 0);
    wtPort(
      IO_PORT_BREAK_CTRL,
      encodeBreakCtrl(2, true, false, BREAK_RDWR_RD),
    );

    expect(getPendingIrq() & IRQ1_BIT).toBe(0);

    // LD R0, 0x0200; H
    runSteps([0x2708, watch, 0x2000], 1);

    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(rdPort(0x21)).toBe(INT_CAUSE_CODE.ADDR_BREAK);
    expect(rdPort(IO_PORT_BREAK_HIT)).toBe(2);
    expect(rdPort(IO_PORT_BREAK_PREV)).toBe(0);
  });

  it("MEM WRITE のみ監視のとき READ では上がらない", () => {
    const watch = 0x0300;
    new DataView(getMemory()).setUint16(watch * 2, 0x1111, false);
    wtPort(IO_PORT_BREAK_ADDR_LO, watch);
    wtPort(IO_PORT_BREAK_ADDR_HI, 0);
    wtPort(
      IO_PORT_BREAK_CTRL,
      encodeBreakCtrl(0, true, false, BREAK_RDWR_WR),
    );

    runSteps([0x2708, watch, 0x2000], 1);
    expect(getPendingIrq() & IRQ1_BIT).toBe(0);

    // MVWI R0, 0x2222; STD R0, 0x0300
    runSteps([0x7807, 0x2222, 0x2748, watch, 0x2000], 2);
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(rdPort(0x21)).toBe(INT_CAUSE_CODE.ADDR_BREAK);
    expect(rdPort(IO_PORT_BREAK_HIT)).toBe(0);
    expect(rdPort(IO_PORT_BREAK_PREV)).toBe(0x1111);
    runSteps([0x7807, 0x3333, 0x2748, watch, 0x2000], 2);
    expect(rdPort(IO_PORT_BREAK_HIT)).toBe(0);
    expect(rdPort(IO_PORT_BREAK_PREV)).toBe(0x2222);
  });

  it("0033 の次に 0034 を読むと書込前値が取れる", () => {
    const watch = 0x0400;
    new DataView(getMemory()).setUint16(watch * 2, 0xabcd, false);
    wtPort(IO_PORT_BREAK_ADDR_LO, watch);
    wtPort(IO_PORT_BREAK_ADDR_HI, 0);
    wtPort(
      IO_PORT_BREAK_CTRL,
      encodeBreakCtrl(1, true, false, BREAK_RDWR_WR),
    );

    runSteps([0x7807, 0x1000, 0x2748, watch, 0x2000], 2);
    expect(rdPort(IO_PORT_BREAK_HIT)).toBe(1);
    expect(rdPort(IO_PORT_BREAK_PREV)).toBe(0xabcd);
  });

  it("IO アクセス一致でも INT2・要因3 が立つ", () => {
    wtPort(IO_PORT_BREAK_ADDR_LO, 0x0040);
    wtPort(IO_PORT_BREAK_ADDR_HI, 0);
    wtPort(
      IO_PORT_BREAK_CTRL,
      encodeBreakCtrl(3, true, true, BREAK_RDWR_RD),
    );

    // RD R0, 0x40
    runSteps([0x1840, 0x2000], 1);
    expect(getPendingIrq() & IRQ1_BIT).toBe(IRQ1_BIT);
    expect(rdPort(0x21)).toBe(INT_CAUSE_CODE.ADDR_BREAK);
    expect(rdPort(IO_PORT_BREAK_HIT)).toBe(3);
    expect(rdPort(IO_PORT_BREAK_PREV)).toBe(0);
  });
});
