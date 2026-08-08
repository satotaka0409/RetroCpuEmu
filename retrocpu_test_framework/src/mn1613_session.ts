import fs from "node:fs";
import {
  getMemory,
  getState,
  reset,
  run,
  setMemory,
  setPins,
  setState,
} from "../../retrocpu_emu/src/main/feature/cpu/mn1613/mn1613.js";
import { loadIntelHex } from "../../retrocpu_emu/src/main/feature/code_test/intel_hex.js";
import { parseCdb, type CdbTable } from "../../retrocpu_emu/src/main/feature/code_test/cdb.js";
import type { CdbSymbol } from "../../retrocpu_emu/src/main/feature/code_test/types.js";
import {
  assembleToHexCdb,
  defaultHexCdbPaths,
} from "./assemble_link.js";
import type {
  CallOptions,
  CallRegisters,
  CallResult,
  CdbSymbolInfo,
  Mn1613SessionOptions,
  StackWorkExpect,
} from "./types.js";

const H_OPCODE = 0x2000;
const DEFAULT_STACK_INIT = 0xffff;
const DEFAULT_RETURN_STUB = 0x17fe;
const DEFAULT_MAX_CYCLES = 2_000_000;
const DEFAULT_MEMORY_BYTES = 0x20000;
const DEFAULT_INIT_LABEL = "gl_main";

/**
 * 16bit に正規化する。
 * @param value 任意整数
 * @returns 0–0xFFFF
 */
function u16(value: number): number {
  return value & 0xffff;
}

/**
 * 4 桁大文字 16 進。
 * @param n 値
 * @returns 例 "0200"
 */
function hex4(n: number): string {
  return u16(n).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * 現在メモリの DataView。
 * @returns setMemory 済みバッファのビュー
 */
function memView(): DataView {
  return new DataView(getMemory());
}

/**
 * call 用レジスタを CPU に反映する。未指定の R0–R4 は 0。STR は指定時のみ。
 * @param regs 部分指定
 */
function applyCallRegisters(regs: CallRegisters | undefined): void {
  const r: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  if (regs?.R0 !== undefined) r[0] = u16(regs.R0);
  if (regs?.R1 !== undefined) r[1] = u16(regs.R1);
  if (regs?.R2 !== undefined) r[2] = u16(regs.R2);
  if (regs?.R3 !== undefined) r[3] = u16(regs.R3);
  if (regs?.R4 !== undefined) r[4] = u16(regs.R4);
  const patch: Parameters<typeof setState>[0] = { R: r };
  if (regs?.SP !== undefined) patch.SP = u16(regs.SP);
  if (regs?.STR !== undefined) patch.STR = u16(regs.STR);
  if (regs?.CSBR !== undefined) patch.CSBR = u16(regs.CSBR);
  if (regs?.SSBR !== undefined) patch.SSBR = u16(regs.SSBR);
  setState(patch);
}

/**
 * CDB を大文字小文字無視で引く。
 * @param table parseCdb 結果
 * @param name ラベル
 * @returns シンボル
 */
function requireCdbSymbol(table: CdbTable, name: string): CdbSymbol {
  const key = name.toUpperCase();
  const exact = table.byName.get(name) ?? table.byName.get(key);
  if (exact) {
    return exact;
  }
  for (const [n, s] of table.byName) {
    if (n.toUpperCase() === key) {
      return s;
    }
  }
  throw new Error(`CDB symbol not found: ${name}`);
}

/**
 * ワード列を比較し、違えば例外を投げる。
 * @param label メッセージ用
 * @param actual 実際
 * @param expected 期待
 */
function assertWords(label: string, actual: number[], expected: number[]): void {
  if (actual.length !== expected.length) {
    throw new Error(`${label}: length ${actual.length} !== ${expected.length}`);
  }
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i]! & 0xffff;
    const e = expected[i]! & 0xffff;
    if (a !== e) {
      throw new Error(`${label}[${i}]: expected 0x${hex4(e)}, got 0x${hex4(a)}`);
    }
  }
}

/**
 * Intel HEX + CDB を MN1613 エミュに載せ、TS からサブルーチンを呼び出すセッション。
 * 根拠: test_framework.mdc
 */
export class Mn1613AsmSession {
  readonly hexFile: string;
  readonly cdbFile: string;
  readonly initLabel: string | null;
  readonly stackInit: number;
  readonly returnStubWordAddr: number;
  readonly maxCycles: number;
  readonly memoryBytes: number;
  private cdb: CdbTable;
  private lastResult: CallResult | null = null;
  private lastPreCallSp = 0;

  /**
   * @param hexFile Intel HEX パス
   * @param cdbFile CDB パス
   * @param options 初期化ラベル・スタック・スタブ
   */
  constructor(
    hexFile: string,
    cdbFile: string,
    options: Mn1613SessionOptions,
  ) {
    this.hexFile = hexFile;
    this.cdbFile = cdbFile;
    this.initLabel =
      options.initLabel === undefined ? DEFAULT_INIT_LABEL : options.initLabel;
    this.stackInit = options.stackInit ?? DEFAULT_STACK_INIT;
    this.returnStubWordAddr = options.returnStubWordAddr ?? DEFAULT_RETURN_STUB;
    this.maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;
    this.memoryBytes = options.memoryBytes ?? DEFAULT_MEMORY_BYTES;
    this.cdb = parseCdb(fs.readFileSync(cdbFile, "utf8"));
  }

  /**
   * HEX をメモリへ再ロードし、戻りスタブ（H）を書く。CPU は reset。
   */
  reload(): void {
    const buf = new ArrayBuffer(this.memoryBytes);
    setMemory(buf);
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
    const hexText = fs.readFileSync(this.hexFile, "utf8");
    loadIntelHex(hexText, memView());
    this.writeReturnStub();
    this.lastResult = null;
    this.lastPreCallSp = 0;
  }

  /** 戻り先に `H`（0x2000）を書く。 */
  writeReturnStub(): void {
    this.writeWord(this.returnStubWordAddr, H_OPCODE);
  }

  /**
   * `initLabel`（既定 `gl_main`）を HALT まで実行する。戻りスタブは使わない。
   * テストケースごとに HEX ロード後に呼ぶ。
   */
  async runInit(): Promise<void> {
    if (this.initLabel === null) {
      return;
    }
    const entry = this.wordAddr(this.initLabel);
    const status = await run(entry, this.maxCycles);
    const st = getState();
    if (status !== "halted") {
      throw new Error(
        `runInit(${this.initLabel}): expected halted, status=${status} IC=0x${hex4(st.IC)}`,
      );
    }
  }

  /**
   * CDB グローバルのワードアドレス。
   * @param name ラベル
   * @returns ワードアドレス
   */
  wordAddr(name: string): number {
    return requireCdbSymbol(this.cdb, name).wordAddr;
  }

  /**
   * CDB シンボルを返す。
   * @param name ラベル
   * @returns バイト／ワードアドレス
   */
  getSymbol(name: string): CdbSymbolInfo {
    const s = requireCdbSymbol(this.cdb, name);
    return { name: s.name, byteAddr: s.byteAddr, wordAddr: s.wordAddr };
  }

  /**
   * ワードアドレスへ 16bit をビッグエンディアンで書く。
   * @param wordAddr ワードアドレス
   * @param value 16bit 値
   */
  writeWord(wordAddr: number, value: number): void {
    memView().setUint16(u16(wordAddr) * 2, u16(value), false);
  }

  /**
   * ワードアドレスから 16bit をビッグエンディアンで読む。
   * @param wordAddr ワードアドレス
   * @returns 16bit 値
   */
  readWord(wordAddr: number): number {
    return memView().getUint16(u16(wordAddr) * 2, false);
  }

  /**
   * ラベル位置へワード列を書く。
   * @param name CDB ラベル
   * @param words ワード列
   */
  writeLabelWords(name: string, words: number[]): void {
    const base = this.wordAddr(name);
    for (let i = 0; i < words.length; i += 1) {
      this.writeWord(base + i, words[i]!);
    }
  }

  /**
   * サブルーチンを呼び、戻りスタブの H で止まるまで実行する。
   * メモリと IO ピンは維持する（RNG 種・ハンドシェイク状態を残す）。
   * @param label `.global` ラベル（CDB）
   * @param options レジスタ／スタック第3引数
   * @returns 停止時レジスタ
   */
  async call(label: string, options: CallOptions = {}): Promise<CallResult> {
    if (options.resetCpu) {
      reset();
      this.writeReturnStub();
    }

    const entryWordAddr = this.wordAddr(label);
    applyCallRegisters(options.registers);

    let sp = options.registers?.SP ?? this.stackInit;
    for (const word of options.stack ?? []) {
      this.writeWord(sp, word);
      sp = u16(sp - 1);
    }
    this.writeWord(sp, this.returnStubWordAddr);
    sp = u16(sp - 1);
    if (options.retl) {
      this.writeWord(sp, getState().CSBR & 0xf);
      sp = u16(sp - 1);
    }
    setState({ SP: sp });

    const preCallSp = getState().SP;
    this.lastPreCallSp = preCallSp;
    const status = await run(entryWordAddr, this.maxCycles);
    const registers = getState();
    if (status !== "halted") {
      throw new Error(
        `call(${label}): expected halted at stub, status=${status} IC=0x${hex4(registers.IC)}`,
      );
    }
    const ic = u16(registers.IC);
    const stub = u16(this.returnStubWordAddr);
    if (ic !== stub && ic !== u16(stub + 1)) {
      throw new Error(
        `call(${label}): did not return to stub (IC=0x${hex4(ic)}, stub=0x${hex4(stub)})`,
      );
    }

    const result: CallResult = {
      status,
      registers: {
        R: [...registers.R],
        SP: registers.SP,
        STR: registers.STR,
        IC: registers.IC,
        CSBR: registers.CSBR,
        SSBR: registers.SSBR,
      },
      preCallSp,
      entryWordAddr,
    };
    this.lastResult = result;
    return result;
  }

  /**
   * レジスタを検証する。
   * @param expected 期待値（指定分のみ）
   * @param actual 省略時は直近 call、無ければ現在値
   */
  expectRegisters(
    expected: CallRegisters,
    actual?: CallResult["registers"],
  ): void {
    const reg = actual ?? this.lastResult?.registers ?? getState();
    const r = "R" in reg && Array.isArray(reg.R) ? reg.R : getState().R;
    /**
     * 1 レジスタを比較する。
     * @param name 表示名
     * @param got 実際
     * @param exp 期待（未指定ならスキップ）
     */
    const check = (name: string, got: number, exp: number | undefined): void => {
      if (exp === undefined) return;
      if ((got & 0xffff) !== (exp & 0xffff)) {
        throw new Error(
          `register ${name}: expected 0x${hex4(exp)}, got 0x${hex4(got)}`,
        );
      }
    };
    check("R0", r[0]!, expected.R0);
    check("R1", r[1]!, expected.R1);
    check("R2", r[2]!, expected.R2);
    check("R3", r[3]!, expected.R3);
    check("R4", r[4]!, expected.R4);
    check("SP", reg.SP, expected.SP);
    check("STR", reg.STR, expected.STR);
    check("CSBR", reg.CSBR, expected.CSBR);
    check("SSBR", reg.SSBR, expected.SSBR);
  }

  /**
   * メモリのワード列を検証する。
   * @param wordAddr 開始ワード
   * @param expected 期待ワード列
   */
  expectMemoryWords(wordAddr: number, expected: number[]): void {
    const actual = expected.map((_, i) => this.readWord(wordAddr + i));
    assertWords(`mem@0x${hex4(wordAddr)}`, actual, expected);
  }

  /**
   * ラベル位置のワード列を検証する。
   * @param name CDB ラベル
   * @param expected 期待ワード列
   */
  expectLabelWords(name: string, expected: number[]): void {
    this.expectMemoryWords(this.wordAddr(name), expected);
  }

  /**
   * スタックワークを検証する。
   * @param spec preCallSp 基準のオフセットと期待ワード
   */
  expectStackWork(spec: StackWorkExpect): void {
    const base = this.lastPreCallSp || this.lastResult?.preCallSp;
    if (base === undefined) {
      throw new Error("expectStackWork: no preCallSp (call first)");
    }
    const start = (base + spec.offset) & 0xffff;
    const actual = spec.words.map((_, i) => this.readWord(start + i));
    assertWords(`stack@preCallSp+${spec.offset}`, actual, spec.words);
  }
}

/**
 * HEX / CDB をロードしたセッションを作る。`sources` があれば先にアセンブルして書き出す。
 * `runInit()` は呼ばない（テストごとに mock attach 後へ）。
 * @param options hex/cdb パス、任意で sources と initLabel
 * @returns ロード済みセッション
 */
export function createMn1613AsmSession(
  options: Mn1613SessionOptions,
): Mn1613AsmSession {
  const defaults = defaultHexCdbPaths();
  const hexFile = options.hexFile ?? defaults.hexFile;
  const cdbFile = options.cdbFile ?? defaults.cdbFile;

  if (options.sources && options.sources.length > 0) {
    assembleToHexCdb({
      sources: options.sources,
      cpu: options.cpu,
      codeOrgWord: options.codeOrgWord,
      hexFile,
      cdbFile,
    });
  }

  if (!fs.existsSync(hexFile)) {
    throw new Error(
      `Intel HEX がありません: ${hexFile}\n` +
        "`sources` を渡すか、テストに hexFile を書いてビルドしてください",
    );
  }
  if (!fs.existsSync(cdbFile)) {
    throw new Error(
      `CDB がありません: ${cdbFile}\n` +
        "`sources` を渡すか、テストに cdbFile を書いてビルドしてください",
    );
  }

  const session = new Mn1613AsmSession(hexFile, cdbFile, options);
  session.reload();
  return session;
}
