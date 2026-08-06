/**
 * MN1613 コードテスト・ハーネス
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

import {
  clearBreakpoints,
  getExecStatus,
  getMemory,
  getState,
  reset,
  run,
  setMemory,
  setPins,
  setState,
  type CPURegister,
} from "../cpu/mn1613/mn1613";
import { parseCdb, requireSymbol, type CdbTable } from "./cdb";
import { loadIntelHex } from "./intel_hex";
import type {
  CallOptions,
  CallRegisters,
  CallResult,
  Mn1613CodeTestOptions,
  StackWorkExpect,
} from "./types";

const H_OPCODE = 0x2000;
const DEFAULT_STACK = 0xffff;
const DEFAULT_STUB = 0x17fe;
const DEFAULT_MAX_CYCLES = 100_000;
const DEFAULT_MEM_BYTES = 0x40000 * 2;

function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function applyCallRegisters(regs?: CallRegisters): void {
  if (!regs) return;
  const partial: Parameters<typeof setState>[0] = {};
  const R: number[] = [];
  let hasR = false;
  if (regs.R0 !== undefined) {
    R[0] = regs.R0;
    hasR = true;
  }
  if (regs.R1 !== undefined) {
    R[1] = regs.R1;
    hasR = true;
  }
  if (regs.R2 !== undefined) {
    R[2] = regs.R2;
    hasR = true;
  }
  if (regs.R3 !== undefined) {
    R[3] = regs.R3;
    hasR = true;
  }
  if (regs.R4 !== undefined) {
    R[4] = regs.R4;
    hasR = true;
  }
  if (hasR) partial.R = R;
  if (regs.SP !== undefined) partial.SP = regs.SP;
  if (regs.STR !== undefined) partial.STR = regs.STR;
  if (regs.CSBR !== undefined) partial.CSBR = regs.CSBR;
  if (regs.SSBR !== undefined) partial.SSBR = regs.SSBR;
  if (regs.TSR0 !== undefined) partial.TSR0 = regs.TSR0;
  if (regs.TSR1 !== undefined) partial.TSR1 = regs.TSR1;
  setState(partial);
}

function pushWord(sp: number, value: number): number {
  // SP は空きスロット: 現在 SP に書いてから下げる
  writeWord(sp, value);
  return (sp - 1) & 0xffff;
}

function view(): DataView {
  return new DataView(getMemory());
}

export function readWord(wordAddr: number): number {
  const off = (wordAddr & 0xffff) * 2;
  return view().getUint16(off, false);
}

export function writeWord(wordAddr: number, value: number): void {
  const off = (wordAddr & 0xffff) * 2;
  view().setUint16(off, value & 0xffff, false);
}

export function readBytes(byteAddr: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  const v = view();
  for (let i = 0; i < length; i++) {
    out[i] = v.getUint8((byteAddr + i) >>> 0);
  }
  return out;
}

export function writeBytes(byteAddr: number, data: Uint8Array | number[]): void {
  const v = view();
  for (let i = 0; i < data.length; i++) {
    v.setUint8((byteAddr + i) >>> 0, data[i]! & 0xff);
  }
}

function assertWords(label: string, actual: number[], expected: number[]): void {
  if (actual.length !== expected.length) {
    throw new Error(
      `${label}: length ${actual.length} !== ${expected.length}`,
    );
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

export class Mn1613CodeTest {
  readonly stackInit: number;
  readonly returnStubWordAddr: number;
  readonly maxCycles: number;
  private cdb: CdbTable = { byName: new Map(), symbols: [] };
  private lastResult: CallResult | null = null;
  private lastPreCallSp = 0;

  constructor(opts: Mn1613CodeTestOptions = {}) {
    this.stackInit = opts.stackInit ?? DEFAULT_STACK;
    this.returnStubWordAddr = opts.returnStubWordAddr ?? DEFAULT_STUB;
    this.maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
    const memBytes = opts.memoryBytes ?? DEFAULT_MEM_BYTES;
    setMemory(new ArrayBuffer(memBytes));
    this.resetCpu();
  }

  /** CPU／ブレークをリセットし、SP と戻りスタブを初期化する */
  resetCpu(): void {
    setPins({
      HLT: false,
      RST: false,
      IRQ0: false,
      IRQ1: false,
      IRQ2: false,
      BSAV: false,
      STRT: false,
    });
    reset();
    clearBreakpoints();
    setState({ SP: this.stackInit });
    writeWord(this.returnStubWordAddr, H_OPCODE);
  }

  loadIntelHex(hexText: string): void {
    loadIntelHex(hexText, view());
    // スタブは HEX で上書きされる可能性があるので再設置
    writeWord(this.returnStubWordAddr, H_OPCODE);
  }

  loadCdb(cdbText: string): void {
    this.cdb = parseCdb(cdbText);
  }

  getSymbol(name: string) {
    return requireSymbol(this.cdb, name);
  }

  /** ゼロページ（ワードアドレス → ワード値） */
  writeZeroPageWords(map: Record<number, number>): void {
    for (const [k, v] of Object.entries(map)) {
      const addr = Number(k) & 0xff;
      writeWord(addr, v);
    }
  }

  writeLabelWords(name: string, words: number[]): void {
    const sym = requireSymbol(this.cdb, name);
    for (let i = 0; i < words.length; i++) {
      writeWord(sym.wordAddr + i, words[i]!);
    }
  }

  writeLabelBytes(name: string, data: Uint8Array | number[]): void {
    const sym = requireSymbol(this.cdb, name);
    writeBytes(sym.byteAddr, data);
  }

  /**
   * CDB ラベルをサブルーチンとして呼び、戻りスタブで停止するまで実行する。
   */
  async call(label: string, options: CallOptions = {}): Promise<CallResult> {
    const sym = requireSymbol(this.cdb, label);
    this.resetCpu();

    let sp = this.stackInit;
    const stackArgs = options.stack ?? [];
    for (const w of stackArgs) {
      sp = pushWord(sp, w);
    }
    sp = pushWord(sp, this.returnStubWordAddr);
    setState({ SP: sp });
    applyCallRegisters(options.registers);
    // call 後も SP を options.registers.SP で潰さないよう、registers に SP が無ければ維持
    if (options.registers?.SP === undefined) {
      setState({ SP: sp });
    }

    const preCallSp = getState().SP;
    this.lastPreCallSp = preCallSp;

    const status = await run(sym.wordAddr, this.maxCycles);
    const registers = getState();
    if (status !== "halted") {
      throw new Error(
        `call(${label}): expected halted at stub, status=${status} IC=0x${hex4(registers.IC)}`,
      );
    }
    if ((registers.IC & 0xffff) !== ((this.returnStubWordAddr + 1) & 0xffff)) {
      // H 実行後 IC は次ワード。許容: stub または stub+1
      const ic = registers.IC & 0xffff;
      const stub = this.returnStubWordAddr & 0xffff;
      if (ic !== stub && ic !== ((stub + 1) & 0xffff)) {
        throw new Error(
          `call(${label}): did not return to stub (IC=0x${hex4(ic)}, stub=0x${hex4(stub)})`,
        );
      }
    }

    const result: CallResult = {
      status: getExecStatus(),
      registers,
      preCallSp,
      entryWordAddr: sym.wordAddr,
    };
    this.lastResult = result;
    return result;
  }

  expectRegisters(
    expected: CallRegisters,
    actual?: CPURegister,
  ): void {
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
    check("CSBR", reg.CSBR, expected.CSBR);
    check("SSBR", reg.SSBR, expected.SSBR);
  }

  expectMemoryWords(wordAddr: number, expected: number[]): void {
    const actual = expected.map((_, i) => readWord(wordAddr + i));
    assertWords(`mem@0x${hex4(wordAddr)}`, actual, expected);
  }

  expectMemoryBytes(byteAddr: number, expected: number[] | Uint8Array): void {
    const exp = Array.from(expected);
    const actual = Array.from(readBytes(byteAddr, exp.length));
    for (let i = 0; i < exp.length; i++) {
      if ((actual[i]! & 0xff) !== (exp[i]! & 0xff)) {
        throw new Error(
          `memByte@0x${byteAddr.toString(16)}[${i}]: expected 0x${(exp[i]! & 0xff).toString(16)}, got 0x${(actual[i]! & 0xff).toString(16)}`,
        );
      }
    }
  }

  expectLabelWords(name: string, expected: number[]): void {
    const sym = requireSymbol(this.cdb, name);
    this.expectMemoryWords(sym.wordAddr, expected);
  }

  expectLabelBytes(name: string, expected: number[] | Uint8Array): void {
    const sym = requireSymbol(this.cdb, name);
    this.expectMemoryBytes(sym.byteAddr, expected);
  }

  /**
   * スタックワーク検証。
   * from=preCallSp, offset=0 は call 直前に SP が指していた空きスロット位置のワード
   * （直前の PUSH で書かれた値を見る場合は offset=+1）。
   */
  expectStackWork(spec: StackWorkExpect): void {
    const base =
      spec.from === "preCallSp"
        ? this.lastPreCallSp || this.lastResult?.preCallSp
        : undefined;
    if (base === undefined) {
      throw new Error("expectStackWork: no preCallSp (call first)");
    }
    const start = (base + spec.offset) & 0xffff;
    const actual = spec.words.map((_, i) => readWord(start + i));
    assertWords(`stack@preCallSp+${spec.offset}`, actual, spec.words);
  }
}

export function createMn1613CodeTest(
  opts?: Mn1613CodeTestOptions,
): Mn1613CodeTest {
  return new Mn1613CodeTest(opts);
}
