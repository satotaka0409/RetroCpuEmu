/**
 * 起動シーケンス（1階 IO 主導）
 * 根拠: MN1613.mdc / TMS9995 リセットベクタ 0000h / retrocpu_emu.mdc
 */

import { CPU_TYPE } from "../ioboard/setting_area";
import { getCpuCore } from "./cpu_core";
import {
  attachIoBoardPorts,
  MONITOR_ENTRY_WORD,
  OPCODE_H,
  RESET_VECTOR_IC_OFF,
  RESET_VECTOR_STR_OFF,
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
 * CPU の RAM へ 1 ワード書く（MN1613 ワードアドレス）。
 * @param wordAddr ワードアドレス
 * @param value 16bit 値
 */
function writeWordMn1613(wordAddr: number, value: number, getMemory: () => ArrayBufferLike): void {
  const view = new DataView(getMemory());
  const off = (wordAddr & 0xffff) * 2;
  if (off + 1 < view.byteLength) {
    view.setUint16(off, value & 0xffff, false);
  }
}

/**
 * 電源投入直後: リセット待ち（実行しない）。
 * @param cpuType 1=MN1613 / 2=TMS9995
 */
export function enterResetWait(cpuType: number = CPU_TYPE.MN1613): BootResult {
  const core = getCpuCore(cpuType);
  attachIoBoardPorts();
  resetAddrComparators();
  if (cpuType === CPU_TYPE.TMS9995) {
    core.setPins({
      HLT: false,
      RST: false,
      IRQ1: false,
      IRQ2: false,
      NMI: false,
    } as Parameters<typeof core.setPins>[0]);
  } else {
    core.setPins({
      HLT: false,
      RST: false,
      IRQ0: false,
      IRQ1: false,
      IRQ2: false,
      BSAV: false,
      STRT: false,
    });
  }
  core.powerOnIdle();
  const st = core.getState();
  return {
    phase: "reset_wait",
    log: [
      "[boot] power on — waiting for RESET (idle)",
      `[boot] IC=0x${(st.IC & 0xffff).toString(16).toUpperCase().padStart(4, "0")} status=${core.getExecStatus()}`,
    ],
    ic: st.IC,
    status: core.getExecStatus(),
  };
}

/**
 * 暫定ブートスタブ（MN1613 単体試験用）。
 */
export function loadHaltStubAtMonitorEntry(cpuType: number = CPU_TYPE.MN1613): BootResult {
  const core = getCpuCore(cpuType);
  if (cpuType === CPU_TYPE.TMS9995) {
    return {
      phase: "vector_ready",
      log: ["[boot] TMS9995: reset vector is mem[0]/mem[2] (from DMA IHX)"],
      ic: core.getState().IC,
      status: core.getExecStatus(),
    };
  }
  const vec = MONITOR_ENTRY_WORD;
  const start = (vec + RESET_VECTOR_IC_OFF + 1) & 0xffff;
  writeWordMn1613(vec + RESET_VECTOR_STR_OFF, 0, core.getMemory);
  writeWordMn1613(vec + RESET_VECTOR_IC_OFF, start, core.getMemory);
  writeWordMn1613(start, OPCODE_H, core.getMemory);
  setResetVector(vec);
  return {
    phase: "vector_ready",
    log: [
      `[boot] stub: mem[0x${start.toString(16).toUpperCase()}]=H (0x${OPCODE_H.toString(16).toUpperCase()})`,
      `[boot] RESET_VECTOR (IO:0) <= 0x${vec.toString(16).toUpperCase().padStart(4, "0")} STR/IC at +2/+3`,
    ],
    ic: core.getState().IC,
    status: core.getExecStatus(),
  };
}

/**
 * RST パルスを送り CPU を起動する。
 */
export function pulseCpuReset(cpuType: number = CPU_TYPE.MN1613): BootResult {
  const core = getCpuCore(cpuType);
  core.setPins({ HLT: false });
  core.setPins({ RST: true });
  core.setPins({ RST: false });
  const st = core.getState();
  return {
    phase: "reset_pulsed",
    log: [
      cpuType === CPU_TYPE.TMS9995
        ? "[boot] RESET pulsed — WP/PC from mem[0]/mem[2]"
        : "[boot] RESET pulsed — CPU read IO:0 then mem[+2]=STR / mem[+3]=IC, running",
      `[boot] IC=0x${(st.IC & 0xffff).toString(16).toUpperCase().padStart(4, "0")} status=${core.getExecStatus()}`,
    ],
    ic: st.IC,
    status: core.getExecStatus(),
  };
}

/** コールドブート（MN1613 暫定 HALT スタブ） */
export function coldBootHaltStub(cpuType: number = CPU_TYPE.MN1613): BootResult {
  const logs: string[] = [];
  const a = enterResetWait(cpuType);
  logs.push(...a.log);
  const b = loadHaltStubAtMonitorEntry(cpuType);
  logs.push(...b.log);
  const c = pulseCpuReset(cpuType);
  logs.push(...c.log);
  return {
    phase: c.phase,
    log: logs,
    ic: c.ic,
    status: c.status,
  };
}
