/** メイン ↔ レンダラで共有するスナップショット型 */

import type { BeepWire } from "./beep";

export type { BeepWire };

export type LedDisplayWire = {
  sevenSeg: number[];
  bulletLed0_7: number;
  bulletLed8_F: number;
};

export type LcdStateWire = {
  cols: number;
  rows: number;
  lines: [string, string];
  cursorRow: number;
  cursorCol: number;
  displayOn: boolean;
  cursorOn: boolean;
  blinkOn: boolean;
};

export type ConsoleStateWire = {
  wordAddr: number;
  dataWord: number;
  focus: "addr" | "data";
  mode: "monitor" | "setting_area";
  halted: boolean;
  undefInsn: boolean;
};

export type EmuSnapshotWire = {
  status: string;
  regs: {
    R: number[];
    SP: number;
    STR: number;
    IC: number;
    CSBR: number;
    SSBR: number;
    TSR0: number;
    TSR1: number;
    OSR: number[];
    NPP: number;
    IISR: number;
    SBRB: number;
    ICB: number;
  };
  pins: {
    HLT: boolean;
    RUN: boolean;
    RST: boolean;
    IRQ0: boolean;
    IRQ1: boolean;
    IRQ2: boolean;
  };
  frame: number;
  led: LedDisplayWire;
  console: ConsoleStateWire;
  lcd: LcdStateWire;
  /** リセットからの CPU クロック（10進文字列。64bit） */
  clockCount: string;
};

export type EmuApi = {
  onSnapshot: (cb: (snap: EmuSnapshotWire) => void) => () => void;
  onBeep: (cb: (beep: BeepWire) => void) => () => void;
  getSnapshot: () => Promise<EmuSnapshotWire>;
  keyHex: (digit: string) => void;
  keyFn: (fn: string) => void;
  keyAdsLongPress: () => void;
  loadIntelHex: (hex: string) => Promise<{
    bytesWritten: number;
    minAddr: number;
    maxAddr: number;
    chunks: number;
  }>;
};
