/**
 * エミュレータ UI / IPC 用スナップショット型
 */

import type { ExecStatus, CPURegister } from "../cpu/mn1613/mn1613";
import type { CpuPins } from "../cpu/mn1613/mn1613pin";
import type { IoConsoleState } from "./io_console";

/** ハンドシェイク LED表示依頼 (0x16) またはパネル駆動のラッチ */
export type LedDisplayWire = {
  sevenSeg: number[];
  bulletLed0_7: number;
  bulletLed8_F: number;
};

export type EmuSnapshot = {
  status: ExecStatus;
  regs: CPURegister;
  pins: CpuPins;
  memRows: { addr: string; hex: string; ascii: string }[];
  frame: number;
  led: LedDisplayWire;
  /** IO 前面パネル状態 */
  console: IoConsoleState;
};
