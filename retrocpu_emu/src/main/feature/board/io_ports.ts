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

export function getResetVector(): number {
  return _resetVector & 0xffff;
}

/** IO ボード側が RESET_VECTOR レジスタに書く（モニター展開後に 0x0200 を流す） */
export function setResetVector(wordAddr: number): void {
  _resetVector = wordAddr & 0xffff;
}

export function attachHandshakeBus(bus: CpuIoSignals | null): void {
  _handshakeBus = bus;
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
    }
  });
}
