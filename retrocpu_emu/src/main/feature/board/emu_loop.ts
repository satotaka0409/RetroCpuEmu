/**
 * エミュレータ主ループ（retrocpu_emu.mdc）
 *
 * 1. レトロCPU（ピン監視込みの tick）
 * 2. IOボード
 * 3. （間引き）UI 購読者へスナップショット
 *
 * WebSocket は未接続（プレースホルダ）。
 */

import {
  getExecStatus,
  getPins,
  getState,
  getMemory,
  tickCpu,
  type ExecStatus,
  type CPURegister,
} from "../cpu/mn1613/mn1613";
import type { CpuPins } from "../cpu/mn1613/mn1613pin";
import { tickIoBoard } from "./io_board";
import { isDmaBusy } from "./dma";

export type EmuSnapshot = {
  status: ExecStatus;
  regs: CPURegister;
  pins: CpuPins;
  /** IC 近傍のメモリダンプ（表示用） */
  memRows: { addr: string; hex: string; ascii: string }[];
  frame: number;
};

export type EmuLoopOptions = {
  /** 1フレームあたりの CPU 命令数 */
  cpuStepsPerFrame?: number;
  /** UI 通知間隔（フレーム数）。1=毎フレーム */
  uiEveryFrames?: number;
};

type Listener = (snap: EmuSnapshot) => void;

let _raf = 0;
let _running = false;
let _frame = 0;
let _steps = 64;
let _uiEvery = 1;
const _listeners = new Set<Listener>();

function hex4(n: number): string {
  return (n & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function buildMemRows(ic: number): EmuSnapshot["memRows"] {
  const buf = getMemory();
  const view = new DataView(buf);
  const base = (ic & 0xfff8) >>> 0;
  const rows: EmuSnapshot["memRows"] = [];
  for (let row = 0; row < 4; row++) {
    const addr = (base + row * 8) & 0xffff;
    const hex = Array.from({ length: 8 }, (_, i) => {
      const waddr = (addr + i) & 0xffff;
      const off = waddr * 2;
      if (off + 1 >= view.byteLength) return "----";
      return view
        .getUint16(off, false)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0");
    }).join(" ");
    let asciiW = "";
    for (let i = 0; i < 8; i++) {
      const waddr = (addr + i) & 0xffff;
      const off = waddr * 2;
      if (off + 1 >= view.byteLength) {
        asciiW += "..";
        continue;
      }
      const w = view.getUint16(off, false);
      const hi = (w >>> 8) & 0xff;
      const lo = w & 0xff;
      asciiW += hi >= 0x20 && hi < 0x7f ? String.fromCharCode(hi) : ".";
      asciiW += lo >= 0x20 && lo < 0x7f ? String.fromCharCode(lo) : ".";
    }
    rows.push({
      addr: hex4(addr),
      hex,
      ascii: asciiW,
    });
  }
  return rows;
}

export function getSnapshot(): EmuSnapshot {
  const regs = getState();
  return {
    status: getExecStatus(),
    regs,
    pins: getPins(),
    memRows: buildMemRows(regs.IC),
    frame: _frame,
  };
}

function notify(): void {
  if (_listeners.size === 0) return;
  const snap = getSnapshot();
  for (const cb of _listeners) cb(snap);
}

function frame(): void {
  if (!_running) return;
  _frame++;

  // DMA 中は他処理を行わない（retrocpu_emu.mdc 2-2）
  if (!isDmaBusy()) {
    // 1. CPU（内部でピン監視 → 命令）
    for (let i = 0; i < _steps; i++) {
      tickCpu();
    }
    // 2. IOボード（HSHK 等）
    tickIoBoard();
  }

  // 3. WebSocket: 未実装

  // 2-4 React 表示（間引き）
  if (_frame % _uiEvery === 0) {
    notify();
  }

  _raf = requestAnimationFrame(frame);
}

export function startEmuLoop(opts: EmuLoopOptions = {}): void {
  _steps = opts.cpuStepsPerFrame ?? 64;
  _uiEvery = opts.uiEveryFrames ?? 1;
  if (_running) return;
  _running = true;
  _raf = requestAnimationFrame(frame);
}

export function stopEmuLoop(): void {
  _running = false;
  if (_raf) cancelAnimationFrame(_raf);
  _raf = 0;
}

export function isEmuLoopRunning(): boolean {
  return _running;
}

export function subscribeEmu(listener: Listener): () => void {
  _listeners.add(listener);
  listener(getSnapshot());
  return () => {
    _listeners.delete(listener);
  };
}
