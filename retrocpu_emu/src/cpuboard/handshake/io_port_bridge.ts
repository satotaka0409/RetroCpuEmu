/**
 * MN1613 RD/WT ポートと CpuIoSignals バスのブリッジ
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc / HandShake.mdc
 *
 * 0020 INTERRUPT_BUSY Bit0
 * 0021 INT_CAUSE Bit0-2
 * 0022 出力制御: OUT_REQ/ENA/OUT_DENA/IN_DACK
 * 0023 HSHK_OUT_DATA (CPU->IO)
 * 0024 入力制御: IN_REQ/IN_DENA/IN_DACK/OUT_DACK
 * 0025 HSHK_IN_DATA (IO->CPU)
 */

import type { CpuIoSignals } from "../mn1613/mn1613ioport";

export const IO_PORT = {
  INTERRUPT_BUSY: 0x20,
  INT_CAUSE: 0x21,
  HSHK_OUT_CTRL: 0x22,
  HSHK_OUT_DATA: 0x23,
  HSHK_IN_CTRL: 0x24,
  HSHK_IN_DATA: 0x25,
} as const;

export const HSHK_CTRL_BIT = {
  OUT_REQ: 0x01,
  ENA: 0x02,
  OUT_DENA: 0x04,
  IN_DACK: 0x08,
} as const;

export const HSHK_IN_CTRL_BIT = {
  IN_REQ: 0x01,
  IN_DENA: 0x02,
  IN_DACK: 0x04,
  OUT_DACK: 0x08,
} as const;

export type HandshakeIoPortBridge = {
  read: (port: number) => number;
  write: (port: number, val: number) => void;
};

/**
 * CPU の RD/WT コールバックとして使えるブリッジを作る。
 * REQ_1 は IO 側専用のため、CPU 書き込みでは変更しない。
 */
export function createHandshakeIoPortBridge(
  bus: CpuIoSignals,
): HandshakeIoPortBridge {
  return {
    read(port: number): number {
      switch (port & 0xffff) {
        case IO_PORT.INTERRUPT_BUSY:
          return bus.INTERRUPT_BUSY & 0x01;
        case IO_PORT.INT_CAUSE:
          return bus.INT_CAUSE & 0x07;
        case IO_PORT.HSHK_OUT_CTRL:
          return (
            (bus.HSHK_ENA ? HSHK_CTRL_BIT.ENA : 0) |
            (bus.HSHK_OUT_DENA ? HSHK_CTRL_BIT.OUT_DENA : 0) |
            (bus.HSHK_IN_DACK ? HSHK_CTRL_BIT.IN_DACK : 0) |
            (bus.HSHK_OUT_REQ ? HSHK_CTRL_BIT.OUT_REQ : 0)
          );
        case IO_PORT.HSHK_OUT_DATA:
          return bus.HSHK_OUT_DATA & 0xff;
        case IO_PORT.HSHK_IN_CTRL:
          return (
            (bus.HSHK_IN_REQ ? HSHK_IN_CTRL_BIT.IN_REQ : 0) |
            (bus.HSHK_IN_DENA ? HSHK_IN_CTRL_BIT.IN_DENA : 0) |
            (bus.HSHK_IN_DACK ? HSHK_IN_CTRL_BIT.IN_DACK : 0) |
            (bus.HSHK_OUT_DACK ? HSHK_IN_CTRL_BIT.OUT_DACK : 0)
          );
        case IO_PORT.HSHK_IN_DATA:
          return bus.HSHK_IN_DATA & 0xff;
        default:
          return 0;
      }
    },
    write(port: number, val: number): void {
      const v = val & 0xffff;
      switch (port & 0xffff) {
        case IO_PORT.INTERRUPT_BUSY:
          bus.INTERRUPT_BUSY = (v & 0x01) !== 0 ? 1 : 0;
          break;
        case IO_PORT.INT_CAUSE:
          bus.INT_CAUSE = (v & 0x07) as CpuIoSignals["INT_CAUSE"];
          break;
        case IO_PORT.HSHK_OUT_CTRL:
          bus.HSHK_ENA = (v & HSHK_CTRL_BIT.ENA) !== 0 ? 1 : 0;
          bus.HSHK_OUT_DENA = (v & HSHK_CTRL_BIT.OUT_DENA) !== 0 ? 1 : 0;
          bus.HSHK_IN_DACK = (v & HSHK_CTRL_BIT.IN_DACK) !== 0 ? 1 : 0;
          bus.HSHK_OUT_REQ = (v & HSHK_CTRL_BIT.OUT_REQ) !== 0 ? 1 : 0;
          // REQ_1 は IO ボード側が駆動（CPU 書き込みで消さない）
          break;
        case IO_PORT.HSHK_OUT_DATA:
          bus.HSHK_OUT_DATA = v & 0xff;
          break;
        case IO_PORT.HSHK_IN_CTRL:
          // 通常は IO 側入力だが、テスト用途で書き込みを許可する
          bus.HSHK_IN_REQ = (v & HSHK_IN_CTRL_BIT.IN_REQ) !== 0 ? 1 : 0;
          bus.HSHK_IN_DENA = (v & HSHK_IN_CTRL_BIT.IN_DENA) !== 0 ? 1 : 0;
          bus.HSHK_IN_DACK = (v & HSHK_IN_CTRL_BIT.IN_DACK) !== 0 ? 1 : 0;
          bus.HSHK_OUT_DACK = (v & HSHK_IN_CTRL_BIT.OUT_DACK) !== 0 ? 1 : 0;
          break;
        case IO_PORT.HSHK_IN_DATA:
          // 通常は IO が書くが、テスト用に許可
          bus.HSHK_IN_DATA = v & 0xff;
          break;
        default:
          break;
      }
    },
  };
}
