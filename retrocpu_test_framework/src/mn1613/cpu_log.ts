/**
 * テスト専用 CPU 実行ログ
 * 根拠: asm_test_framework.mdc §テスト専用 CPU ログ出力
 */

import fs from "node:fs";
import path from "node:path";
import {
  getClockCount,
  type CPURegister,
} from "../../../retrocpu_emu/src/cpuboard/mn1613/mn1613.js";
import { parseCdb } from "../../../retrocpu_emu/src/code_test/cdb.js";
import { Mn1613Disassembler } from "../../../retrocpu_emu/src/dis_assembler/mn1613/index.js";
import {
  setActiveCpuLogMarker,
  takePendingCpuLogTestName,
  type CpuLogTestPhase,
} from "../cpu_log_mark.js";
import type { CpuLogMode } from "../types.js";

const STACK_WORDS = 16;

/**
 * 16bit を 4 桁大文字 16 進にする。
 * @param n 値
 * @returns 例 "0200"
 */
function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * CDB のチェックポイントからワードアドレス → ログ用名を作る。
 * 同一ワードに複数あれば `,` で連結する（`add_enter$0001,add_leave$0001`）。
 * @param cdbText CDB 全文
 * @returns ワードアドレス → `name$serial`
 */
export function checkpointsByWordAddr(cdbText: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const cp of parseCdb(cdbText).checkpoints) {
    const label = `${cp.name}$${cp.serial}`;
    const addr = cp.wordAddr & 0xffff;
    const prev = map.get(addr);
    map.set(addr, prev ? `${prev},${label}` : label);
  }
  return map;
}

/**
 * レジスタをログ用 1 フィールドにする。
 * @param st CPU 状態（フェッチ直前）
 * @returns 空白区切り
 */
export function formatCpuLogRegs(st: CPURegister): string {
  return [
    `R0=${hex4(st.R[0]!)}`,
    `R1=${hex4(st.R[1]!)}`,
    `R2=${hex4(st.R[2]!)}`,
    `R3=${hex4(st.R[3]!)}`,
    `R4=${hex4(st.R[4]!)}`,
    `SP=${hex4(st.SP)}`,
    `STR=${hex4(st.STR)}`,
    `IC=${hex4(st.IC)}`,
    `CSBR=${(st.CSBR & 0xf).toString(16).toUpperCase()}`,
    `SSBR=${(st.SSBR & 0xf).toString(16).toUpperCase()}`,
    `TSR0=${(st.TSR0 & 0xf).toString(16).toUpperCase()}`,
    `TSR1=${(st.TSR1 & 0xf).toString(16).toUpperCase()}`,
    `OSR0=${hex4(st.OSR[0]!)}`,
    `OSR1=${hex4(st.OSR[1]!)}`,
    `OSR2=${hex4(st.OSR[2]!)}`,
    `OSR3=${hex4(st.OSR[3]!)}`,
    `NPP=${(st.NPP & 0xff).toString(16).toUpperCase().padStart(2, "0")}`,
    `IISR=${hex4(st.IISR)}`,
    `SBRB=${hex4(st.SBRB)}`,
  ].join(" ");
}

/**
 * SP+1 から 16 ワードを読む（空きスロットの次＝スタック先頭）。
 * @param sp 空きスロット
 * @param readWord ワードアドレス → 16bit
 * @returns 空白区切り hex4
 */
export function formatCpuLogStack(
  sp: number,
  readWord: (wordAddr: number) => number,
): string {
  const words: string[] = [];
  for (let i = 1; i <= STACK_WORDS; i += 1) {
    words.push(hex4(readWord((sp + i) & 0xffff)));
  }
  return words.join(" ");
}

/** チェックポイント命令の実行前／実行後（instruction モードは after のみ） */
export type CpuLogPhase = "before" | "after";

type PendingInstruction = {
  ic: number;
  /** チェックポイント名。無ければ `-` */
  name: string;
  hit: number;
  data: string;
  disasm: string;
};

/**
 * テスト専用 CPU ログ。
 * 本文モード無し（`null`）は START/END のみ。本文は TAB 区切り:
 * clock / addr / data / checkpoint / phase / hits / disasm / regs / stack16
 */
export class CpuExecutionLog {
  private readonly filePath: string;
  private mode: CpuLogMode | null;
  private readonly checkpoints: Map<number, string>;
  private readonly disasm: Mn1613Disassembler;
  private readonly readWord: (wordAddr: number) => number;
  private readonly hits = new Map<number, number>();
  private pending: PendingInstruction | null = null;

  /**
   * @param filePath 出力ファイル（既存なら切り詰める）
   * @param cdbText ラベル／チェックポイント用 CDB
   * @param readWord ワード読み（論理アドレス、CSBR=0 前提）
   * @param mode 本文モード。`null` / 省略は START/END のみ
   */
  constructor(
    filePath: string,
    cdbText: string,
    readWord: (wordAddr: number) => number,
    mode: CpuLogMode | null = null,
  ) {
    this.filePath = path.resolve(filePath);
    this.mode = mode;
    this.checkpoints = checkpointsByWordAddr(cdbText);
    this.disasm = new Mn1613Disassembler({ cdbText });
    this.readWord = readWord;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, "", "utf8");
    setActiveCpuLogMarker(this);
    const pending = takePendingCpuLogTestName();
    if (pending) {
      this.appendTestMark(pending, "START");
    }
  }

  /** 現在の本文モード。`null` は START/END のみ */
  get logMode(): CpuLogMode | null {
    return this.mode;
  }

  /**
   * 出力モードを切り替える（同一ファイル・同一セッション）。
   * @param mode `checkpoint` / `instruction`。`null` で START/END のみ
   */
  setMode(mode: CpuLogMode | null): void {
    this.mode = mode;
    this.pending = null;
  }

  /**
   * `test()` タイトルを START / END で追記する。
   * @param name ケース名
   * @param phase START / END
   */
  appendTestMark(name: string, phase: CpuLogTestPhase): void {
    fs.appendFileSync(this.filePath, `${name} ${phase}\n`, "utf8");
  }

  /** このテスト開始時点からの通過回数を捨てる（reload 時）。 */
  resetHits(): void {
    this.hits.clear();
    this.pending = null;
  }

  /**
   * セクション見出しを書く（本文モード無しでは書かない）。
   * @param kind reload / runInit / call
   * @param label 対象ラベル（無ければ空）
   */
  beginRun(kind: string, label = ""): void {
    this.pending = null;
    if (this.mode === null) {
      return;
    }
    const extra = label ? ` ${label}` : "";
    fs.appendFileSync(this.filePath, `# ${kind}${extra}\n`, "utf8");
  }

  /**
   * フェッチ直前。
   * 本文無し: 何もしない。
   * `checkpoint`: チェックポイント命令のときだけ before を書く。
   * `instruction`: 命令情報だけ保持（行は出さない）。
   * @param state IRQ 処理後・フェッチ前
   */
  onBeforeExecute(state: CPURegister): void {
    if (this.mode === null) {
      this.pending = null;
      return;
    }

    const ic = state.IC & 0xffff;
    const cpName = this.checkpoints.get(ic);

    if (this.mode === "checkpoint") {
      if (!cpName) {
        this.pending = null;
        return;
      }
      const pending = this.capturePending(ic, cpName);
      this.pending = pending;
      this.writeRecord("before", pending, state);
      return;
    }

    const pending = this.capturePending(ic, cpName ?? "-");
    this.pending = pending;
  }

  /**
   * 命令実行直後。
   * 本文無し: 何もしない。
   * `checkpoint`: 直前がチェックポイントなら after を書く。
   * `instruction`: 直前に保持した命令の after を書く。
   * @param state 実行後（IC は次命令／分岐先のことがある）
   */
  onAfterExecute(state: CPURegister): void {
    if (this.mode === null) {
      this.pending = null;
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.writeRecord("after", pending, state);
  }

  /**
   * 実行前の命令情報を撮る（ヒット数を増やす）。
   * @param ic 命令ワードアドレス
   * @param name チェックポイント名または `-`
   * @returns pending
   */
  private capturePending(ic: number, name: string): PendingInstruction {
    const hit = (this.hits.get(ic) ?? 0) + 1;
    this.hits.set(ic, hit);
    const dis = this.disasm.disassemble(ic, this.readWord);
    const dataWords: string[] = [];
    for (let i = 0; i < dis.wordCount; i += 1) {
      dataWords.push(hex4(this.readWord((ic + i) & 0xffff)));
    }
    return {
      ic,
      name,
      hit,
      data: dataWords.join(" "),
      disasm: dis.text,
    };
  }

  /**
   * 1 行追記する。addr / data / disasm は実行した命令側。
   * @param phase before / after
   * @param pending 実行前に撮った命令情報
   * @param state 当該フェーズのレジスタ
   */
  private writeRecord(
    phase: CpuLogPhase,
    pending: PendingInstruction,
    state: CPURegister,
  ): void {
    const line = [
      getClockCount().toString(),
      hex4(pending.ic),
      pending.data,
      pending.name,
      phase,
      String(pending.hit),
      pending.disasm,
      formatCpuLogRegs(state),
      formatCpuLogStack(state.SP, this.readWord),
    ].join("\t");
    fs.appendFileSync(this.filePath, `${line}\n`, "utf8");
  }
}
