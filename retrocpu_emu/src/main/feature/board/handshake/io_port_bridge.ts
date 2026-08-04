/**
 * MN1613 RD/WT ポートと CpuIoSignals バスのブリッジ
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc / HandShake.mdc
 *
 * 0020 INTERRUPT_BUSY Bit0
 * 0021 INT_CAUSE Bit0-2
 * 0022 制御: ENA/DENA/DACK/REQ0/REQ1
 * 0023 HSHK_IN_DATA
 * 0024 HSHK_OUT_DATA
 */

import type { CpuIoSignals } from "../../cpu/mn1613/mn1613ioport";

export const IO_PORT = {
  INTERRUPT_BUSY: 0x20,
  INT_CAUSE: 0x21,
  HSHK_CTRL: 0x22,
  HSHK_IN_DATA: 0x23,
  HSHK_OUT_DATA: 0x24,
} as const;

export const HSHK_CTRL_BIT = {
  ENA: 0x01,
  DENA: 0x02,
  DACK: 0x04,
  REQ0: 0x08,
  REQ1: 0x10,
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
        case IO_PORT.HSHK_CTRL:
          return (
            (bus.HSHK_ENA ? HSHK_CTRL_BIT.ENA : 0) |
            (bus.HSHK_DENA ? HSHK_CTRL_BIT.DENA : 0) |
            (bus.HSHK_DACK ? HSHK_CTRL_BIT.DACK : 0) |
            (bus.HSHK_REQ_0 ? HSHK_CTRL_BIT.REQ0 : 0) |
            (bus.HSHK_REQ_1 ? HSHK_CTRL_BIT.REQ1 : 0)
          );
        case IO_PORT.HSHK_IN_DATA:
          return bus.HSHK_IN_DATA & 0xff;
        case IO_PORT.HSHK_OUT_DATA:
          return bus.HSHK_OUT_DATA & 0xff;
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
        case IO_PORT.HSHK_CTRL:
          bus.HSHK_ENA = (v & HSHK_CTRL_BIT.ENA) !== 0 ? 1 : 0;
          bus.HSHK_DENA = (v & HSHK_CTRL_BIT.DENA) !== 0 ? 1 : 0;
          bus.HSHK_DACK = (v & HSHK_CTRL_BIT.DACK) !== 0 ? 1 : 0;
          bus.HSHK_REQ_0 = (v & HSHK_CTRL_BIT.REQ0) !== 0 ? 1 : 0;
          // REQ_1 は IO ボード側が駆動（CPU 書き込みで消さない）
          break;
        case IO_PORT.HSHK_IN_DATA:
          bus.HSHK_IN_DATA = v & 0xff;
          break;
        case IO_PORT.HSHK_OUT_DATA:
          // 通常は IO が書くが、テスト用に許可
          bus.HSHK_OUT_DATA = v & 0xff;
          break;
        default:
          break;
      }
    },
  };
}
