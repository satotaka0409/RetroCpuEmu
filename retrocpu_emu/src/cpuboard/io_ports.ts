/**
 * 1階 IO ボードのポートマップ（簡易）
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc
 *
 * 0000 RESET_VECTOR — リセット時 CPU が読むベクタ表の先頭（+2=STR / +3=IC）
 * 0020〜0024 — ハンドシェイク（任意で bridge 接続）
 * 0030〜0034 — CPLD アドレス比較器（設定・ヒット・前回書込値）
 * 0036〜0037 — CPLD ステップ実行（ENA / トリガ命令語）
 */

import type { CpuIoSignals } from "./mn1613/mn1613ioport";
import {
  setIoReadCallback,
  setIoWriteCallback,
  triggerInterrupt,
} from "./mn1613/mn1613";
import {
  createHandshakeIoPortBridge,
  IO_PORT as HSHK_IO_PORT,
} from "./handshake/io_port_bridge";
import {
  addrComparators,
  IO_PORT_BREAK_ADDR_HI,
  IO_PORT_BREAK_ADDR_LO,
  IO_PORT_BREAK_CTRL,
  IO_PORT_BREAK_HIT,
  IO_PORT_BREAK_PREV,
} from "./mn1613/addr_comparator";
import {
  IO_PORT_STEP_COM,
  IO_PORT_STEP_ENA,
  stepBreak,
} from "./mn1613/step_break";
import { INT_CAUSE_CODE } from "../shared/handshake/handshake_type";

/** IO:0000 — リセットベクタ（ワードアドレス） */
export const IO_PORT_RESET_VECTOR = 0x0000;

/** モニターのリセットベクタ表先頭（IO:0 が返す値。`g_reset_vector`） */
export const MONITOR_ENTRY_WORD = 0x0108;
/** IO:0 の値からの STR 語オフセット（MN1613.mdc） */
export const RESET_VECTOR_STR_OFF = 2;
/** IO:0 の値からの IC 語オフセット（MN1613.mdc） */
export const RESET_VECTOR_IC_OFF = 3;

/** H 命令オペコード */
export const OPCODE_H = 0x2000;

let _resetVector = MONITOR_ENTRY_WORD;
let _handshakeBus: CpuIoSignals | null = null;
let _intCause = 0;
let _interruptBusy = 0;

/**
 * リセット時に CPU が IO:0 から読むベクタ表の先頭を返す。
 * @returns ワードアドレス（既定は `g_reset_vector` 0x0108）
 */
export function getResetVector(): number {
  return _resetVector & 0xffff;
}

/** IO ボード側が RESET_VECTOR レジスタに書く（モニター展開後に 0x0108 を流す） */
export function setResetVector(wordAddr: number): void {
  _resetVector = wordAddr & 0xffff;
}

/**
 * ハンドシェイク信号バスを登録する（0x20〜0x24 の委譲先）。
 * @param bus 接続するバス。null で切り離す
 */
export function attachHandshakeBus(bus: CpuIoSignals | null): void {
  _handshakeBus = bus;
}

/**
 * 割り込み要因（IO:0021 Bit0-2）を IO ボード側から設定する。
 * ハンドシェイクバス接続時はバスへ、未接続時は内部ラッチへ書く。
 * @param cause INT_CAUSE_CODE の値（下位 3bit のみ有効）
 */
export function setIntCause(cause: number): void {
  _intCause = cause & 0x07;
  if (_handshakeBus) {
    _handshakeBus.INT_CAUSE = _intCause as CpuIoSignals["INT_CAUSE"];
  }
}

/**
 * 割り込み処理中フラグ（IO:0020 Bit0）の現在値を返す。
 * CPU の割り込みハンドラが立てている間は 1。
 * @returns 0 または 1
 */
export function getInterruptBusy(): number {
  return _handshakeBus ? _handshakeBus.INTERRUPT_BUSY : _interruptBusy;
}

/**
 * ハンドシェイク転送中（HSHK_ENA=1）かどうかを返す。
 * バス未接続時は常に false。
 * @returns 転送中なら true
 */
export function isHandshakeActive(): boolean {
  return _handshakeBus ? _handshakeBus.HSHK_ENA === 1 : false;
}

/**
 * アドレス比較一致時: INT_CAUSE=3（ADDR_BREAK）を載せ、レベル2割り込みを上げる。
 * 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc（要因番号 3）
 */
function raiseAddrBreakIrq(_slot: number): void {
  setIntCause(INT_CAUSE_CODE.ADDR_BREAK);
  triggerInterrupt(2);
}

/**
 * ステップワンショット: INT_CAUSE=4（STEP）を載せ、レベル2割り込みを上げる。
 * 根拠: breakpoint.mdc（要因番号 4）
 */
function raiseStepBreakIrq(): void {
  setIntCause(INT_CAUSE_CODE.STEP);
  triggerInterrupt(2);
}

/**
 * CPU の RD/WT コールバックを IO ボードポートに接続する。
 * 既存のハンドシェイク bridge があれば 0x20〜0x24 を委譲する。
 * 0030〜0034 は CPLD 比較器。一致時は INT2・要因 3。
 * 0036〜0037 はステップ。ヒット時は INT2・要因 4。
 */
export function attachIoBoardPorts(): void {
  const hshk = _handshakeBus
    ? createHandshakeIoPortBridge(_handshakeBus)
    : null;

  addrComparators.setOnHit(raiseAddrBreakIrq);
  stepBreak.setOnHit(raiseStepBreakIrq);

  setIoReadCallback((port) => {
    const p = port & 0xffff;
    if (p === IO_PORT_RESET_VECTOR) {
      return _resetVector & 0xffff;
    }
    const breakVal = addrComparators.readPort(p);
    if (breakVal !== null) {
      return breakVal;
    }
    const stepVal = stepBreak.readPort(p);
    if (stepVal !== null) {
      return stepVal;
    }
    if (
      hshk &&
      (p === HSHK_IO_PORT.INTERRUPT_BUSY ||
        p === HSHK_IO_PORT.INT_CAUSE ||
        p === HSHK_IO_PORT.HSHK_CTRL ||
        p === HSHK_IO_PORT.HSHK_IN_DATA ||
        p === HSHK_IO_PORT.HSHK_OUT_DATA)
    ) {
      return hshk.read(p);
    }
    // バス未接続でも割り込み要因・処理中フラグは CPU から見える必要がある
    if (p === HSHK_IO_PORT.INTERRUPT_BUSY) return _interruptBusy;
    if (p === HSHK_IO_PORT.INT_CAUSE) return _intCause;
    return 0;
  });

  setIoWriteCallback((port, val) => {
    const p = port & 0xffff;
    if (p === IO_PORT_RESET_VECTOR) {
      _resetVector = val & 0xffff;
      return;
    }
    if (
      p === IO_PORT_BREAK_CTRL ||
      p === IO_PORT_BREAK_ADDR_LO ||
      p === IO_PORT_BREAK_ADDR_HI ||
      p === IO_PORT_BREAK_HIT ||
      p === IO_PORT_BREAK_PREV
    ) {
      addrComparators.writePort(p, val);
      return;
    }
    if (p === IO_PORT_STEP_ENA || p === IO_PORT_STEP_COM) {
      stepBreak.writePort(p, val);
      return;
    }
    if (hshk) {
      hshk.write(p, val);
      return;
    }
    if (p === HSHK_IO_PORT.INTERRUPT_BUSY) {
      _interruptBusy = val & 1;
    }
  });
}

/**
 * 比較器バンクとステップ・ワンショットを初期化する（リセット／テスト用）。
 * ヒット通知は attachIoBoardPorts 後も維持する。
 */
export function resetAddrComparators(): void {
  addrComparators.reset();
  addrComparators.setOnHit(raiseAddrBreakIrq);
  stepBreak.reset();
  stepBreak.setOnHit(raiseStepBreakIrq);
}
