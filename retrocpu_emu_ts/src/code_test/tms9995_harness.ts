/**
 * TMS9995 コードテスト・ハーネス
 * 根拠: asm_test_framework.mdc（バイトアドレス・R11 復帰）
 */

import type { CPURegister } from "../cpuboard/mn1613/mn1613";
import {
  getExecStatus,
  getMemory,
  getState,
  peekByte,
  pokeByte,
  powerOnIdle,
  reset,
  setMemory,
  setPins,
  setState,
  startRun,
  tickCpu,
} from "../cpuboard/tms9995/tms9995";
import { TMS_MEM_BYTES } from "../cpuboard/tms9995/types";
import {
  emptyCdbTable,
  parseTms9995Cdb,
  requireTms9995Symbol,
  type CdbTable,
} from "./cdb";
import { loadIntelHex } from "./intel_hex";
import type {
  CallOptions,
  CallRegisters,
  CallResult,
  CdbCheckpoint,
  Tms9995CodeTestOptions,
} from "./types";

const IDLE_OPCODE = 0x0340;
const DEFAULT_WP = 0xfe00;
const DEFAULT_STACK = 0xfe00;
const DEFAULT_STUB = 0x8100;
const DEFAULT_MAX_CYCLES = 100_000;

/**
 * 16bit 値を 4 桁の大文字 16 進文字列にする（エラーメッセージ用）。
 * @param n 対象の値
 */
function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * 現在の CPU メモリに対する DataView を作る。
 */
function view(): DataView {
  return new DataView(getMemory() as ArrayBuffer);
}

/**
 * メモリから 1 ワード読む（バイトアドレス、BE）。
 * @param byteAddr 偶数バイトアドレス
 */
export function readWord(byteAddr: number): number {
  const a = byteAddr & 0xfffe;
  return view().getUint16(a, false);
}

/**
 * メモリへ 1 ワード書く（バイトアドレス、BE）。
 * @param byteAddr 偶数バイトアドレス
 * @param value 16bit 値
 */
export function writeWord(byteAddr: number, value: number): void {
  const a = byteAddr & 0xfffe;
  view().setUint16(a, value & 0xffff, false);
}

/**
 * ワークスペース Rn を書く。
 * @param wp ワークスペース先頭バイトアドレス
 * @param n レジスタ番号 0–15
 * @param value 16bit 値
 */
function writeWorkspaceReg(wp: number, n: number, value: number): void {
  writeWord((wp + (n & 0x0f) * 2) & 0xffff, value);
}

/**
 * 呼び出し前のレジスタ指定をワークスペース／ST に反映する。
 * @param wp ワークスペース先頭
 * @param regs 部分指定
 */
function applyCallRegisters(wp: number, regs?: CallRegisters): void {
  if (!regs) return;
  if (regs.R0 !== undefined) writeWorkspaceReg(wp, 0, regs.R0);
  if (regs.R1 !== undefined) writeWorkspaceReg(wp, 1, regs.R1);
  if (regs.R2 !== undefined) writeWorkspaceReg(wp, 2, regs.R2);
  if (regs.R3 !== undefined) writeWorkspaceReg(wp, 3, regs.R3);
  if (regs.R4 !== undefined) writeWorkspaceReg(wp, 4, regs.R4);
  if (regs.SP !== undefined) writeWorkspaceReg(wp, 10, regs.SP);
  if (regs.STR !== undefined) setState({ ST: regs.STR });
}

/**
 * ワード列を比較し、違えば例外を投げる。
 * @param label エラーメッセージ用
 * @param actual 実際
 * @param expected 期待
 */
function assertWords(
  label: string,
  actual: number[],
  expected: number[],
): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: length ${actual.length} !== ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]! & 0xffff;
    const e = expected[i]! & 0xffff;
    if (a !== e) {
      throw new Error(
        `${label}[${i}]: expected 0x${hex4(e)}, got 0x${hex4(a)}`,
      );
    }
  }
}

export class Tms9995CodeTest {
  readonly workspaceByteAddr: number;
  readonly stackInit: number;
  readonly returnStubByteAddr: number;
  readonly maxCycles: number;
  private cdb: CdbTable = emptyCdbTable();
  private lastResult: CallResult | null = null;

  /**
   * @param opts ワークスペース／スタブ／最大 tick 数
   */
  constructor(opts: Tms9995CodeTestOptions = {}) {
    this.workspaceByteAddr = opts.workspaceByteAddr ?? DEFAULT_WP;
    this.stackInit = opts.stackInit ?? DEFAULT_STACK;
    this.returnStubByteAddr = opts.returnStubByteAddr ?? DEFAULT_STUB;
    this.maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
    setMemory(new ArrayBuffer(TMS_MEM_BYTES));
    this.resetCpu();
  }

  /** CPU と戻りスタブを初期化する */
  resetCpu(): void {
    setPins({
      HLT: false,
      RST: false,
      IRQ1: false,
      IRQ2: false,
      NMI: false,
    });
    powerOnIdle();
    const wp = this.workspaceByteAddr;
    writeWord(0, wp);
    writeWord(2, 0x8000);
    reset();
    writeWord(this.returnStubByteAddr, IDLE_OPCODE);
    setState({ WP: wp, ST: 0 });
    writeWorkspaceReg(wp, 10, this.stackInit);
  }

  /**
   * Intel HEX を 64KB RAM へ展開する。
   * @param hexText HEX 全文
   */
  loadIntelHex(hexText: string): void {
    loadIntelHex(hexText, view());
    writeWord(this.returnStubByteAddr, IDLE_OPCODE);
  }

  /**
   * CDB を読み込む（奇数バイトアドレス可）。
   * @param cdbText CDB 全文
   */
  loadCdb(cdbText: string): void {
    this.cdb = parseTms9995Cdb(cdbText);
  }

  /** チェックポイント一覧 */
  getCheckpoints(): readonly CdbCheckpoint[] {
    return this.cdb.checkpoints;
  }

  /**
   * ラベルをサブルーチンとして呼び、IDLE スタブで停止するまで tick する。
   * @param label CDB ラベル名
   * @param options ワークスペース初期値（R2 等）
   */
  async call(label: string, options: CallOptions = {}): Promise<CallResult> {
    const sym = requireTms9995Symbol(this.cdb, label);
    this.resetCpu();
    writeWord(this.returnStubByteAddr, IDLE_OPCODE);

    const wp = this.workspaceByteAddr;
    applyCallRegisters(wp, options.registers);
    if (options.registers?.SP === undefined) {
      writeWorkspaceReg(wp, 10, this.stackInit);
    }
    writeWorkspaceReg(wp, 11, this.returnStubByteAddr);

    setState({ WP: wp, IC: sym.byteAddr });
    startRun();

    let cycles = 0;
    while (cycles < this.maxCycles) {
      tickCpu();
      cycles += 1;
      const status = getExecStatus();
      if (status === "halted") break;
      if (status === "break") {
        throw new Error(`call(${label}): CPU break at IC=0x${hex4(getState().IC)}`);
      }
    }
    if (getExecStatus() !== "halted") {
      throw new Error(
        `call(${label}): timeout after ${this.maxCycles} ticks IC=0x${hex4(getState().IC)}`,
      );
    }

    const registers = getState();
    const stub = this.returnStubByteAddr & 0xffff;
    const ic = registers.IC & 0xffff;
    if (ic !== stub && ic !== ((stub + 2) & 0xffff)) {
      throw new Error(
        `call(${label}): did not return to IDLE stub (IC=0x${hex4(ic)}, stub=0x${hex4(stub)})`,
      );
    }

    const result: CallResult = {
      status: getExecStatus(),
      registers,
      preCallSp: registers.SP,
      entryWordAddr: sym.wordAddr,
    };
    this.lastResult = result;
    return result;
  }

  /**
   * レジスタ（ワークスペース R0–R4 / SP / ST）を検証する。
   * @param expected 期待値（部分指定可）
   */
  expectRegisters(expected: CallRegisters, actual?: CPURegister): void {
    const reg = actual ?? this.lastResult?.registers ?? getState();
    const check = (name: string, got: number, exp: number | undefined) => {
      if (exp === undefined) return;
      if ((got & 0xffff) !== (exp & 0xffff)) {
        throw new Error(
          `register ${name}: expected 0x${hex4(exp)}, got 0x${hex4(got)}`,
        );
      }
    };
    check("R0", reg.R[0], expected.R0);
    check("R1", reg.R[1], expected.R1);
    check("R2", reg.R[2], expected.R2);
    check("R3", reg.R[3], expected.R3);
    check("R4", reg.R[4], expected.R4);
    check("SP", reg.SP, expected.SP);
    check("STR", reg.STR, expected.STR);
  }

  /**
   * バイトアドレスからワード列を検証する。
   * @param byteAddr 開始バイトアドレス（偶数）
   * @param expected 期待ワード列
   */
  expectMemoryWords(byteAddr: number, expected: number[]): void {
    const actual = expected.map((_, i) => readWord(byteAddr + i * 2));
    assertWords(`mem@0x${hex4(byteAddr)}`, actual, expected);
  }

  /**
   * ラベル位置のワード列を検証する。
   * @param name ラベル名
   * @param expected 期待ワード列
   */
  expectLabelWords(name: string, expected: number[]): void {
    const sym = requireTms9995Symbol(this.cdb, name);
    this.expectMemoryWords(sym.byteAddr, expected);
  }
}

/**
 * ハーネスを生成する。
 * @param opts Tms9995CodeTest オプション
 */
export function createTms9995CodeTest(
  opts?: Tms9995CodeTestOptions,
): Tms9995CodeTest {
  return new Tms9995CodeTest(opts);
}

/** テスト用バイト読み書き */
export { peekByte, pokeByte };
