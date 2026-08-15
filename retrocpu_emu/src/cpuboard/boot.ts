/**
 * 起動シーケンス（1階 IO 主導）
 * 根拠: MN1613.mdc リセット / MN1613_CPUボードメモリ_IOマップ.mdc / retrocpu_emu.mdc
 *
 * 動作モデル:
 *   - ブートモニタは LED を使わない
 *   - CPU は基本 HALT。IO ボードからの DMA／ハンドシェイク指示で動く
 *   - LED(0x16) はユーザープログラム実行時のみ
 *
 * 本番起動は IO ボード（F7 RST / 電源投入）がブートモニタを DMA して RST する。
 * `coldBootHaltStub` は CPU 単体試験用。Worker では `enterResetWait` のみ使う。
 */

import {
  getExecStatus,
  getMemory,
  getState,
  powerOnIdle,
  setPins,
} from "./mn1613/mn1613";
import {
  attachIoBoardPorts,
  MONITOR_ENTRY_WORD,
  OPCODE_H,
  resetAddrComparators,
  setResetVector,
} from "./io_ports";

export type BootPhase = "reset_wait" | "vector_ready" | "reset_pulsed" | "halted";

export type BootResult = {
  phase: BootPhase;
  log: string[];
  ic: number;
  status: string;
};

/**
 * CPU の RAM へ 1 ワード書く（範囲外は無視）。
 * @param wordAddr ワードアドレス
 * @param value 16bit 値
 */
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
  resetAddrComparators();
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
 * 暫定ブートスタブ: 入口に H を置き、RESET_VECTOR=0x0108 を IO:0 に流す。
 * （モニタ本体は未実装。LED も使わない）
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
 * HLT が立ったままだと reset 直後にまた halted になるので先に落とす（F7 RST / 電源投入）。
 * @returns パルス後の IC と実行状態
 */
export function pulseCpuReset(): BootResult {
  setPins({ HLT: false });
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
 * コールドブート（BIOS/モニタ無し暫定）。
 * リセット待ち → HALT スタブ展開 → RST →（CPU Worker が H を実行して halted＝IO 指示待ち）
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
