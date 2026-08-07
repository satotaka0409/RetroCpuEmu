/**
 * 1階 IO ボードのポートマップ（簡易）
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc
 *
 * 0000 RESET_VECTOR — リセット時 CPU が読む起動 IC
 * 0020〜0024 — ハンドシェイク（任意で bridge 接続）
 */

import type { CpuIoSignals } from "../cpu/mn1613/mn1613ioport";
import {
  setIoReadCallback,
  setIoWriteCallback,
} from "../cpu/mn1613/mn1613";
import {
  createHandshakeIoPortBridge,
  IO_PORT as HSHK_IO_PORT,
} from "./handshake/io_port_bridge";

/** IO:0000 — リセットベクタ（ワードアドレス） */
export const IO_PORT_RESET_VECTOR = 0x0000;

/** モニター入口（メモリマップ上の既定） */
export const MONITOR_ENTRY_WORD = 0x0200;

/** H 命令オペコード */
export const OPCODE_H = 0x2000;

let _resetVector = MONITOR_ENTRY_WORD;
let _handshakeBus: CpuIoSignals | null = null;
let _intCause = 0;
let _interruptBusy = 0;

/**
 * リセット時に CPU が読む起動アドレスを返す。
 * @returns ワードアドレス（既定はモニター入口 0x0200）
 */
export function getResetVector(): number {
  return _resetVector & 0xffff;
}

/** IO ボード側が RESET_VECTOR レジスタに書く（モニター展開後に 0x0200 を流す） */
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
 * CPU の RD/WT コールバックを IO ボードポートに接続する。
 * 既存のハンドシェイク bridge があれば 0x20〜0x24 を委譲する。
 */
export function attachIoBoardPorts(): void {
  const hshk = _handshakeBus
    ? createHandshakeIoPortBridge(_handshakeBus)
    : null;

  setIoReadCallback((port) => {
    const p = port & 0xffff;
    if (p === IO_PORT_RESET_VECTOR) {
      return _resetVector & 0xffff;
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
    if (hshk) {
      hshk.write(p, val);
      return;
    }
    if (p === HSHK_IO_PORT.INTERRUPT_BUSY) {
      _interruptBusy = val & 1;
    }
  });
}
