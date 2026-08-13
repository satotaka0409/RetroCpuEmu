/**
 * エミュレータ UI / IPC 用スナップショット型
 */

import type { ExecStatus, CPURegister } from "../cpuboard/mn1613/mn1613";
import type { CpuPins } from "../cpuboard/mn1613/mn1613pin";
import type { IoConsoleState } from "../ioboard/hex_keyboard/io_console";
import type { LcdConsoleWire } from "../ioboard/lcd_console";

/** ハンドシェイク LED表示依頼 (0x13) またはパネル駆動のラッチ */
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
  /** LCD1602（ハンドシェイク 19h/1Ah） */
  lcd: LcdConsoleWire;
  /** リセットからの CPU クロック（10進文字列。64bit） */
  clockCount: string;
};
