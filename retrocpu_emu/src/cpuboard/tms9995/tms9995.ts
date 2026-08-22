/**
 * TMS9995 CPU エミュレーションコア。
 * 根拠: TMS9995_instruction.mdc / TMS9995_hardware.mdc / MAME tms9995.cpp
 */

import type { CPURegister } from "../mn1613/mn1613";
import {
  clearDeferred,
  commitSample,
  createInputPin,
  createOutputPin,
  risingEdge,
  setInputLevel,
  setOutputLevel,
  takeDeferred,
} from "../pin_signal";
import type { TmsMemOps } from "./addressing";
import { executeInstruction, type TmsExecuteCtx } from "./execute";
import { tms9995IoMmap } from "./io_mmap";
import {
  tms9995MemReadIoByte,
  tms9995MemWriteIoByte,
} from "../io_ports";
import {
  getDecrementerEnabled,
  resetCruTimerFlags,
  setDecrementerEnabled,
} from "./cru_timer";
import type { TmsCpuPins, TmsExecStatus } from "./types";
import { TMS_MEM_BYTES } from "./types";

const CYCLES_PER_INSTR = 12n;
const DEC_ADDR = 0xfffa;
const DEC_TICKS_PER_STEP = 3000n;

let _memory: ArrayBufferLike = new ArrayBuffer(TMS_MEM_BYTES);
let _memView = new DataView(_memory as ArrayBuffer);

let PC = 0;
let WP = 0;
let ST = 0;
let _idle = false;
let _execStatus: TmsExecStatus = "idle";
let _clockCount = 0n;
let _pendingIrq1 = false;
let _pendingIrq2 = false;
let _pendingIrq3 = false;
let _decClockAccum = 0n;

const _pinRST = createInputPin(false);
const _pinHLT = createInputPin(false);
const _pinIRQ1 = createInputPin(false);
const _pinIRQ2 = createInputPin(false);
const _pinNMI = createInputPin(false);
const _pinRUN = createOutputPin(false);

/** 共有 RAM バッファを差し替える（64KB バイトアドレス） */
export function setMemory(buf: ArrayBufferLike): void {
  _memory = buf;
  _memView = new DataView(_memory as ArrayBuffer);
}

/** 現在の RAM バッファを返す */
export function getMemory(): ArrayBufferLike {
  return _memory;
}

/**
 * バイトを読む（FE80 IO / 比較器プローブ付き）。
 * @param addr 16bit バイトアドレス
 */
function readByte(addr: number): number {
  const a = addr & 0xffff;
  const io = tms9995MemReadIoByte(a);
  if (io !== null) return io & 0xff;
  tms9995IoMmap.probe({ addr: a, io: false, write: false });
  return _memView.getUint8(a) & 0xff;
}

/**
 * バイトを書く。
 * @param addr 16bit バイトアドレス
 * @param value 8bit
 */
function writeByte(addr: number, value: number): void {
  const a = addr & 0xffff;
  const prev = readByte(a);
  if (tms9995MemWriteIoByte(a, value & 0xff)) {
    tms9995IoMmap.probe({
      addr: a,
      io: true,
      write: true,
      data: value & 0xff,
      prev,
    });
    return;
  }
  tms9995IoMmap.probe({
    addr: a,
    io: false,
    write: true,
    data: value & 0xff,
    prev,
  });
  _memView.setUint8(a, value & 0xff);
}

/**
 * ワードを読む（ビッグエンディアン、偶数アドレス）。
 * @param addr バイトアドレス
 */
function readWord(addr: number): number {
  const a = addr & 0xfffe;
  return ((readByte(a) << 8) | readByte(a + 1)) & 0xffff;
}

/**
 * ワードを書く。
 * @param addr バイトアドレス
 * @param value 16bit
 */
function writeWord(addr: number, value: number): void {
  const a = addr & 0xfffe;
  const v = value & 0xffff;
  writeByte(a, v >>> 8);
  writeByte(a + 1, v & 0xff);
}

/** ワークスペースレジスタ Rn を読む */
function readReg(n: number): number {
  return readWord(WP + (n & 0x0f) * 2);
}

/** ワークスペースレジスタ Rn を書く */
function writeReg(n: number, value: number): void {
  writeWord(WP + (n & 0x0f) * 2, value & 0xffff);
}

/** 命令フェッチ用ワード読み */
function fetchWord(): number {
  const w = readWord(PC);
  tms9995IoMmap.onInstructionFetch(w);
  tms9995IoMmap.probe({ addr: PC, io: false, write: false });
  PC = (PC + 2) & 0xffff;
  return w;
}

const _memOps: TmsMemOps = {
  fetchWord,
  readWord,
  writeWord,
  readByte,
  writeByte,
  readReg,
  writeReg,
};

/**
 * BLWP 相当（ベクタ先頭＝新 WP、+2＝新 PC）。
 * @param vectorByteAddr ベクタ先頭バイトアドレス
 * @param r11 省略時は書き換えない
 */
function doBlwp(vectorByteAddr: number, r11?: number): void {
  const vec = vectorByteAddr & 0xffff;
  const newWp = readWord(vec) & 0xfffe;
  const newPc = readWord(vec + 2) & 0xfffe;
  writeWord(newWp + 13 * 2, WP);
  writeWord(newWp + 14 * 2, PC);
  writeWord(newWp + 15 * 2, ST);
  if (r11 !== undefined) writeWord(newWp + 11 * 2, r11 & 0xffff);
  WP = newWp;
  PC = newPc;
  ST = (ST & 0xfff0) | ((ST & 0x000f)); // マスクは serviceInterrupt 側で更新
  _idle = false;
}

/** 割り込みベクタへ分岐（MAME tms9995 の intmask 更新に準拠） */
function serviceInterrupt(vector: number, newMask: number): void {
  doBlwp(vector);
  ST = (ST & 0xfff0) | (newMask & 0x000f);
}

/** ペンディング割り込みを処理する */
function handlePendingInterrupts(): boolean {
  const intmask = ST & 0x000f;
  if (_pendingIrq1 && intmask >= 1) {
    _pendingIrq1 = false;
    serviceInterrupt(0x0004, 0);
    return true;
  }
  if (_pendingIrq2 && intmask >= 2) {
    _pendingIrq2 = false;
    serviceInterrupt(0x0008, 1);
    return true;
  }
  if (_pendingIrq3 && intmask >= 3) {
    _pendingIrq3 = false;
    serviceInterrupt(0x000c, 2);
    return true;
  }
  return false;
}

/** 内蔵デクリメンタを 1 命令分進める */
function tickDecrementer(): void {
  if (!getDecrementerEnabled()) return;
  _decClockAccum += CYCLES_PER_INSTR;
  while (_decClockAccum >= DEC_TICKS_PER_STEP) {
    _decClockAccum -= DEC_TICKS_PER_STEP;
    let v = readWord(DEC_ADDR);
    if (v === 0) {
      _pendingIrq3 = true;
      v = 0xffff;
    } else {
      v = (v - 1) & 0xffff;
    }
    writeWord(DEC_ADDR, v);
  }
}

/** 電源投入 idle */
export function powerOnIdle(): void {
  PC = 0;
  WP = 0;
  ST = 0;
  _idle = false;
  _execStatus = "idle";
  _clockCount = 0n;
  _pendingIrq1 = false;
  _pendingIrq2 = false;
  _pendingIrq3 = false;
  resetCruTimerFlags();
  _decClockAccum = 0n;
  for (const p of [_pinRST, _pinHLT, _pinIRQ1, _pinIRQ2, _pinNMI]) {
    clearDeferred(p);
    p[1] = p[0];
  }
  setOutputLevel(_pinRUN, false);
  _pinRUN[1] = false;
}

/** リセット（>0000=WP, >0002=PC） */
export function reset(): void {
  PC = 0;
  WP = 0;
  ST = 0;
  _idle = false;
  _pendingIrq1 = false;
  _pendingIrq2 = false;
  _pendingIrq3 = false;
  resetCruTimerFlags();
  _decClockAccum = 0n;
  for (const p of [_pinRST, _pinHLT, _pinIRQ1, _pinIRQ2, _pinNMI]) {
    clearDeferred(p);
    p[1] = p[0];
  }
  WP = readWord(0) & 0xfffe;
  PC = readWord(2) & 0xfffe;
  _clockCount = 0n;
  _execStatus = "running";
  setOutputLevel(_pinRUN, true);
}

/** 入力ピンを更新する */
export function setPins(pins: Partial<TmsCpuPins>): void {
  if (pins.RST !== undefined) setInputLevel(_pinRST, pins.RST);
  if (pins.HLT !== undefined) setInputLevel(_pinHLT, pins.HLT);
  if (pins.IRQ1 !== undefined) setInputLevel(_pinIRQ1, pins.IRQ1);
  if (pins.IRQ2 !== undefined) setInputLevel(_pinIRQ2, pins.IRQ2);
  if (pins.NMI !== undefined) setInputLevel(_pinNMI, pins.NMI);
  processInputPins();
}

/** ピン 1 サンプル処理 */
export function processInputPins(): void {
  if (risingEdge(_pinRST) || takeDeferred(_pinRST)) {
    reset();
  }
  if (_pinHLT[0] || takeDeferred(_pinHLT)) {
    if (_execStatus === "running") {
      _execStatus = "halted";
      setOutputLevel(_pinRUN, false);
    }
  }
  if (risingEdge(_pinIRQ1) || takeDeferred(_pinIRQ1)) {
    _pendingIrq1 = true;
  }
  if (risingEdge(_pinIRQ2) || takeDeferred(_pinIRQ2)) {
    _pendingIrq2 = true;
  }
  if (risingEdge(_pinNMI) || takeDeferred(_pinNMI)) {
    serviceInterrupt(0xfffc, 0);
  }
  for (const p of [_pinRST, _pinHLT, _pinIRQ1, _pinIRQ2, _pinNMI]) {
    commitSample(p);
  }
  commitSample(_pinRUN);
}

/** ピンスナップショット（Worker 互換で IRQ0=未使用） */
export function getPins(): TmsCpuPins & { IRQ0: boolean; BSAV: boolean; STRT: boolean } {
  return {
    HLT: _pinHLT[0],
    RUN: _execStatus === "running",
    RST: _pinRST[0],
    IRQ1: _pinIRQ1[0],
    IRQ2: _pinIRQ2[0],
    IRQ3: _pendingIrq3,
    NMI: _pinNMI[0],
    IRQ0: false,
    BSAV: false,
    STRT: false,
  };
}

/** MN1613 Worker 互換のレジスタ快照 */
export function getState(): CPURegister {
  return {
    R: [readReg(0), readReg(1), readReg(2), readReg(3), readReg(4)],
    SP: readReg(10),
    STR: ST,
    IC: PC,
    CSBR: 0,
    SSBR: 0,
    TSR0: 0,
    TSR1: 0,
    OSR: [0, 0, 0, 0],
    NPP: 0,
    IISR: 0,
    SBRB: 0,
    ICB: 0,
  };
}

/** 実行状態 */
export function getExecStatus(): TmsExecStatus {
  return _execStatus;
}

/** クロック数 */
export function getClockCount(): bigint {
  return _clockCount;
}

/** 外部から割り込み要求（MN1613 互換 level 0–2） */
export function triggerInterrupt(level: 0 | 1 | 2): void {
  if (level === 1) _pendingIrq1 = true;
  else if (level === 2) _pendingIrq2 = true;
}

/** UI の RUN: 実行再開 */
export function startRun(): void {
  if (_pinHLT[0]) return;
  _idle = false;
  _execStatus = "running";
  setOutputLevel(_pinRUN, true);
}

/** HALT 要求 */
export function requestHalt(): void {
  if (_execStatus === "running") {
    _execStatus = "halted";
    setOutputLevel(_pinRUN, false);
  }
}

/** 1 命令実行 */
function executeOne(): void {
  if (handlePendingInterrupts()) {
    _clockCount += CYCLES_PER_INSTR;
    return;
  }

  if (_idle) {
    if (!handlePendingInterrupts()) return;
    _clockCount += CYCLES_PER_INSTR;
    return;
  }

  const pcBefore = PC;
  const ir = fetchWord();
  const pcAfterOpcode = PC;
  const ctx: TmsExecuteCtx = {
    PC: pcAfterOpcode,
    WP,
    ST,
    idle: _idle,
    mem: _memOps,
    doBlwp: (vec, r11) => {
      doBlwp(vec, r11);
      ctx.PC = PC;
      ctx.WP = WP;
      ctx.ST = ST;
    },
    illegal: () => {
      _execStatus = "break";
    },
  };
  executeInstruction(ctx, ir);
  // 分岐/jump は ctx.PC を更新。順次命令は fetchWord が進めた module PC を正とする。
  if (ctx.PC !== pcAfterOpcode) {
    PC = ctx.PC;
  }
  WP = ctx.WP;
  ST = ctx.ST;
  _idle = ctx.idle;
  _clockCount += CYCLES_PER_INSTR;
  tickDecrementer();

  if (_idle) {
    _execStatus = "halted";
    setOutputLevel(_pinRUN, false);
  } else if (_execStatus === "break") {
    setOutputLevel(_pinRUN, false);
  } else {
    handlePendingInterrupts();
  }

  void pcBefore;
}

/** メインループ 1 ティック */
export function tickCpu(): void {
  processInputPins();
  if (_pinHLT[0] || _execStatus === "idle") return;
  if (_execStatus === "halted") {
    if (_idle || handlePendingInterrupts()) {
      _execStatus = "running";
      setOutputLevel(_pinRUN, true);
    } else {
      return;
    }
  }
  if (_execStatus === "break" || _execStatus === "step") {
    if (handlePendingInterrupts()) {
      _execStatus = "running";
      setOutputLevel(_pinRUN, true);
    } else {
      return;
    }
  }
  executeOne();
}

/** IO 読み書きコールバック（互換スタブ） */
export function setIoReadCallback(_cb: (port: number) => number): void {
  /* TMS9995 は CRU/メモリマップ IO。未使用 */
}

/** IO 書き込みコールバック（互換スタブ） */
export function setIoWriteCallback(_cb: (port: number, value: number) => void): void {
  /* 未使用 */
}

/** テスト用: 部分状態更新 */
export function setState(partial: {
  PC?: number;
  WP?: number;
  ST?: number;
  IC?: number;
}): void {
  if (partial.PC !== undefined) PC = partial.PC & 0xfffe;
  if (partial.IC !== undefined) PC = partial.IC & 0xfffe;
  if (partial.WP !== undefined) WP = partial.WP & 0xfffe;
  if (partial.ST !== undefined) ST = partial.ST & 0xffff;
}

export { getDecrementerEnabled, setDecrementerEnabled } from "./cru_timer";

/** 内蔵 RAM に直接バイト書き込み（テスト用） */
export function pokeByte(addr: number, value: number): void {
  _memView.setUint8(addr & 0xffff, value & 0xff);
}

/** 内蔵 RAM から直接バイト読み（テスト用） */
export function peekByte(addr: number): number {
  return _memView.getUint8(addr & 0xffff) & 0xff;
}

export type { TmsExecStatus, TmsCpuPins };
