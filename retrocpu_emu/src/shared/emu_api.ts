/** メイン ↔ レンダラで共有するスナップショット型 */

export type LedDisplayWire = {
  sevenSeg: number[];
  bulletLed0_7: number;
  bulletLed8_F: number;
};

export type ConsoleStateWire = {
  wordAddr: number;
  dataWord: number;
  focus: "addr" | "data";
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
};

export type EmuApi = {
  onSnapshot: (cb: (snap: EmuSnapshotWire) => void) => () => void;
  getSnapshot: () => Promise<EmuSnapshotWire>;
  keyHex: (digit: string) => void;
  keyFn: (fn: string) => void;
  loadIntelHex: (hex: string) => Promise<{ bytesWritten: number }>;
};
