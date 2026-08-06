/**
 * ブラウザ起動シーケンス（1階相当）
 * 根拠: MN1613.mdc リセット / MN1613_CPUボードメモリ_IOマップ.mdc / retrocpu_emu.mdc
 *
 * 本来: MONITOR を RAM 展開 → IO:0 に 0x0200 → RST パルス
 * 暫定: 0x0200 に H を置き、同様にリセットして即 HALT
 */

import {
  getExecStatus,
  getMemory,
  getState,
  powerOnIdle,
  setPins,
} from "../cpu/mn1613/mn1613";
import {
  attachIoBoardPorts,
  MONITOR_ENTRY_WORD,
  OPCODE_H,
  setResetVector,
} from "./io_ports";

export type BootPhase = "reset_wait" | "vector_ready" | "reset_pulsed" | "halted";

export type BootResult = {
  phase: BootPhase;
  log: string[];
  ic: number;
  status: string;
};

function writeWord(wordAddr: number, value: number): void {
  const view = new DataView(getMemory());
  const off = (wordAddr & 0xffff) * 2;
  if (off + 1 < view.byteLength) {
    view.setUint16(off, value & 0xffff, false);
  }
}

/**
 * 電源投入直後: リセット待ち（実行しない）。
 * IO ポートを接続し、ピンをネゲートした idle にする。
 */
export function enterResetWait(): BootResult {
  attachIoBoardPorts();
  setPins({
    HLT: false,
    RST: false,
    IRQ0: false,
    IRQ1: false,
    IRQ2: false,
    BSAV: false,
    STRT: false,
  });
  powerOnIdle();
  const st = getState();
  return {
    phase: "reset_wait",
    log: [
      "[boot] power on — waiting for RESET (idle)",
      `[boot] IC=0x${(st.IC & 0xffff).toString(16).toUpperCase().padStart(4, "0")} status=${getExecStatus()}`,
    ],
    ic: st.IC,
    status: getExecStatus(),
  };
}

/**
 * 暫定 MONITOR スタブ: 入口に H を置き、RESET_VECTOR=0x0200 を IO:0 に流す。
 */
export function loadHaltStubAtMonitorEntry(): BootResult {
  writeWord(MONITOR_ENTRY_WORD, OPCODE_H);
  setResetVector(MONITOR_ENTRY_WORD);
  return {
    phase: "vector_ready",
    log: [
      `[boot] stub: mem[0x${MONITOR_ENTRY_WORD.toString(16).toUpperCase()}]=H (0x${OPCODE_H.toString(16).toUpperCase()})`,
      `[boot] RESET_VECTOR (IO:0) <= 0x${MONITOR_ENTRY_WORD.toString(16).toUpperCase().padStart(4, "0")}`,
    ],
    ic: getState().IC,
    status: getExecStatus(),
  };
}

/**
 * RST パルスを送り、MN1613 にベクタを読ませて実行開始させる。
 */
export function pulseCpuReset(): BootResult {
  setPins({ RST: true });
  setPins({ RST: false });
  const st = getState();
  return {
    phase: "reset_pulsed",
    log: [
      "[boot] RESET pulsed — CPU read IO:0 → IC, running",
      `[boot] IC=0x${(st.IC & 0xffff).toString(16).toUpperCase().padStart(4, "0")} status=${getExecStatus()}`,
    ],
    ic: st.IC,
    status: getExecStatus(),
  };
}

/**
 * ブラウザ向けコールドブート（MONITOR 無し暫定）。
 * リセット待ち → HALT スタブ展開 → RST →（emu_loop が H を実行して halted）
 */
export function coldBootHaltStub(): BootResult {
  const logs: string[] = [];
  const a = enterResetWait();
  logs.push(...a.log);
  const b = loadHaltStubAtMonitorEntry();
  logs.push(...b.log);
  const c = pulseCpuReset();
  logs.push(...c.log);
  return {
    phase: c.phase,
    log: logs,
    ic: c.ic,
    status: c.status,
  };
}
