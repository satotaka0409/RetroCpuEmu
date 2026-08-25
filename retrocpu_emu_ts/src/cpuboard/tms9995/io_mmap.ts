/**
 * TMS9995 メモリマップド IO（FE80–FE87）。
 * 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc
 *
 * ブレイク設定は FE80 → FE81 → FE82–FE83 の順。途中で FE80 を書くとシーケンスをリセットする。
 * ステップは FE86（ENA）/ FE87（DELAY）。ヒット後 ENA は落ちる（StepBreakUnit）。
 */

import {
  AddrComparatorBank,
  type AddrBusAccess,
  encodeBreakCtrl,
} from "../mn1613/addr_comparator";
import { StepBreakUnit } from "../mn1613/step_break";

/** IO 領域先頭（バイトアドレス） */
export const TMS9995_IO_BASE = 0xfe80;
/** IO 領域末尾 */
export const TMS9995_IO_END = 0xfeff;

/** FE80 — 比較器番号 OUT（Bit0–2、書込専用） */
export const TMS9995_IO_BREAK_SLOT = 0xfe80;
/** FE81 — ENA(Bit3) / MEM·IO(Bit4) / RD·WR(Bit5–6) */
export const TMS9995_IO_BREAK_CTRL = 0xfe81;
/** FE82 — 監視アドレス上位バイト */
export const TMS9995_IO_BREAK_ADDR_HI = 0xfe82;
/** FE83 — 監視アドレス下位バイト */
export const TMS9995_IO_BREAK_ADDR_LO = 0xfe83;
/** FE84 — ヒットした比較器番号 IN（Bit0–2） */
export const TMS9995_IO_BREAK_HIT = 0xfe84;
/** FE85 — 前回書き込み値 IN（8bit） */
export const TMS9995_IO_BREAK_PREV = 0xfe85;
/** FE86 — STEP_BRK_ENA */
export const TMS9995_IO_STEP_ENA = 0xfe86;
/** FE87 — STEP_BRK_DELAY */
export const TMS9995_IO_STEP_DELAY = 0xfe87;

type ProgPhase = "idle" | "slot" | "ctrl" | "addr_hi";

/**
 * FE80–FE87 のブレイク比較器とステップ・ワンショット。
 */
export class Tms9995IoMmap {
  readonly comparators = new AddrComparatorBank();
  readonly step = new StepBreakUnit();

  private phase: ProgPhase = "idle";
  private progSlot = 0;
  private progCtrl = 0;
  private progAddrHi = 0;

  /**
   * ヒット通知を登録する。
   * @param onBreak 比較器ヒット（スロット番号）
   * @param onStep ステップヒット
   */
  setOnHit(
    onBreak: ((slot: number) => void) | null,
    onStep: (() => void) | null,
  ): void {
    this.comparators.setOnHit(onBreak);
    this.step.setOnHit(onStep);
  }

  /** 比較器・ステップ・プログラミング状態を初期化する。 */
  reset(): void {
    this.comparators.reset();
    this.step.reset();
    this.phase = "idle";
    this.progSlot = 0;
    this.progCtrl = 0;
    this.progAddrHi = 0;
  }

  /**
   * アドレスが FE80–FEFF の IO 領域か。
   * @param addr バイトアドレス
   * @returns 領域内なら true
   */
  isIoAddr(addr: number): boolean {
    const a = addr & 0xffff;
    return a >= TMS9995_IO_BASE && a <= TMS9995_IO_END;
  }

  /**
   * メモリリード（FE84/FE85/FE86/FE87。未マップは 0）。
   * @param addr バイトアドレス
   * @returns 下位 8bit。領域外は null
   */
  readByte(addr: number): number | null {
    if (!this.isIoAddr(addr)) return null;
    const a = addr & 0xffff;
    if (a === TMS9995_IO_BREAK_HIT) {
      const hit = this.comparators.readPort(0x0033);
      if (hit === null || hit === 0xffff) return 0xff;
      return hit & 0x07;
    }
    if (a === TMS9995_IO_BREAK_PREV) {
      const prev = this.comparators.readPort(0x0034);
      return prev === null ? 0 : prev & 0xff;
    }
    if (a === TMS9995_IO_STEP_ENA) {
      return this.step.getEnable() & 1;
    }
    if (a === TMS9995_IO_STEP_DELAY) {
      return this.step.getDelayCount() & 0xff;
    }
    // FE80–FE83 は書込専用（読取は 0）
    return 0;
  }

  /**
   * メモリライト（FE80–FE83 / FE86–FE87）。
   * @param addr バイトアドレス
   * @param value バイト値
   * @returns 処理したら true。領域外は false
   */
  writeByte(addr: number, value: number): boolean {
    if (!this.isIoAddr(addr)) return false;
    const a = addr & 0xffff;
    const v = value & 0xff;

    if (a === TMS9995_IO_BREAK_SLOT) {
      this.progSlot = v & 0x07;
      this.progCtrl = 0;
      this.progAddrHi = 0;
      this.phase = "slot";
      return true;
    }
    if (a === TMS9995_IO_BREAK_CTRL) {
      if (this.phase !== "slot" && this.phase !== "ctrl") {
        // 順序崩れ: FE80 からやり直しが必要（途中値は捨てる）
        this.phase = "idle";
        return true;
      }
      this.progCtrl = v;
      this.phase = "ctrl";
      return true;
    }
    if (a === TMS9995_IO_BREAK_ADDR_HI) {
      if (this.phase !== "ctrl" && this.phase !== "addr_hi") {
        this.phase = "idle";
        return true;
      }
      this.progAddrHi = v;
      this.phase = "addr_hi";
      return true;
    }
    if (a === TMS9995_IO_BREAK_ADDR_LO) {
      if (this.phase !== "addr_hi") {
        this.phase = "idle";
        return true;
      }
      this.commitBreak(v);
      this.phase = "idle";
      return true;
    }
    if (a === TMS9995_IO_STEP_ENA) {
      this.step.writePort(0x0036, v);
      return true;
    }
    if (a === TMS9995_IO_STEP_DELAY) {
      this.step.writePort(0x0037, v);
      return true;
    }
    // FE84/FE85 読取専用、その他は無視
    return true;
  }

  /**
   * バスアクセスを比較器に渡す。
   * @param access MEM/IO アクセス
   * @returns ヒットしたスロット。無しは -1
   */
  probe(access: AddrBusAccess): number {
    return this.comparators.probe(access);
  }

  /**
   * 命令フェッチをステップ単位に渡す。
   * @param word 命令語
   */
  onInstructionFetch(word: number): void {
    this.step.onInstructionFetch(word);
  }

  /**
   * FE80–FE83 のシーケンス完了時に比較器へ適用する。
   * @param addrLo アドレス下位バイト
   */
  private commitBreak(addrLo: number): void {
    const slot = this.progSlot & 0x07;
    if (slot > 3) return;
    const ena = (this.progCtrl >>> 3) & 1;
    const io = (this.progCtrl >>> 4) & 1;
    const rdwr = (this.progCtrl >>> 5) & 0x03;
    const ctrl = encodeBreakCtrl(slot, ena !== 0, io !== 0, rdwr);
    const addr16 = ((this.progAddrHi & 0xff) << 8) | (addrLo & 0xff);
    this.comparators.writePort(0x0030, ctrl);
    this.comparators.writePort(0x0031, addr16);
    this.comparators.writePort(0x0032, 0);
  }
}

/** CPU ボード共有の TMS9995 IO マップ */
export const tms9995IoMmap = new Tms9995IoMmap();
