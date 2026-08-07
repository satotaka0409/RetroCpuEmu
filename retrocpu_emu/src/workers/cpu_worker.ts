/**
 * CPU ボード Worker（2階相当）
 * RAM 専有。IO からは DMA / ハンドシェイク RPC（ボードリンク）。
 */

import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import {
  attachSharedBoard,
  CTRL,
  EXEC_CODE,
  STATUS,
  type SharedBoard,
} from "../main/feature/board/shared_board";
import { CpuDmaTarget } from "../main/feature/board/cpu_dma";
import { attachCpuBoardLink } from "../main/feature/board/cpu_board_link";
import { coldBootHaltStub } from "../main/feature/board/boot";
import {
  getExecStatus,
  getPins,
  getState,
  tickCpu,
} from "../main/feature/cpu/mn1613/mn1613";

type WorkerInit = {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  stepsPerSlice?: number;
  sliceMs?: number;
};

const init = workerData as WorkerInit;
const board: SharedBoard = attachSharedBoard(init);
const stepsPerSlice = init.stepsPerSlice ?? 32;
const sliceMs = init.sliceMs ?? 4;

coldBootHaltStub();

const dma = new CpuDmaTarget(5000, {
  onBusy(busy) {
    Atomics.store(board.ctrl, CTRL.DMA_BUSY, busy ? 1 : 0);
  },
});

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let frame = 0;

function execCode(): number {
  switch (getExecStatus()) {
    case "running":
    case "step":
      return EXEC_CODE.running;
    case "halted":
      return EXEC_CODE.halted;
    case "break":
      return EXEC_CODE.breakpoint;
    default:
      return EXEC_CODE.idle;
  }
}

function publishStatus(): void {
  const regs = getState();
  const pins = getPins();
  const s = board.stat;
  Atomics.store(s, STATUS.FRAME, frame);
  Atomics.store(s, STATUS.EXEC, execCode());
  Atomics.store(s, STATUS.HLT, pins.HLT ? 1 : 0);
  Atomics.store(s, STATUS.RUN, pins.RUN ? 1 : 0);
  Atomics.store(s, STATUS.RST, pins.RST ? 1 : 0);
  Atomics.store(s, STATUS.IRQ0, pins.IRQ0 ? 1 : 0);
  Atomics.store(s, STATUS.IRQ1, pins.IRQ1 ? 1 : 0);
  Atomics.store(s, STATUS.IRQ2, pins.IRQ2 ? 1 : 0);
  Atomics.store(s, STATUS.STR, regs.STR & 0xffff);
  Atomics.store(s, STATUS.R0, regs.R[0] & 0xffff);
  Atomics.store(s, STATUS.R1, regs.R[1] & 0xffff);
  Atomics.store(s, STATUS.R2, regs.R[2] & 0xffff);
  Atomics.store(s, STATUS.R3, regs.R[3] & 0xffff);
  Atomics.store(s, STATUS.R4, regs.R[4] & 0xffff);
  Atomics.store(s, STATUS.IC, regs.IC & 0xffff);
  Atomics.store(s, STATUS.SP, regs.SP & 0xffff);
  Atomics.store(s, STATUS.CSBR, regs.CSBR & 0xffff);
  Atomics.store(s, STATUS.SSBR, regs.SSBR & 0xffff);
  Atomics.store(s, STATUS.TSR0, regs.TSR0 & 0xffff);
  Atomics.store(s, STATUS.TSR1, regs.TSR1 & 0xffff);
  Atomics.store(s, STATUS.NPP, regs.NPP & 0xffff);
  Atomics.store(s, STATUS.IISR, regs.IISR & 0xffff);
  Atomics.store(s, STATUS.SBRB, regs.SBRB & 0xffff);
  Atomics.store(s, STATUS.ICB, regs.ICB & 0xffff);
  Atomics.store(s, STATUS.OSR0, regs.OSR[0] & 0xffff);
  Atomics.store(s, STATUS.OSR1, regs.OSR[1] & 0xffff);
  Atomics.store(s, STATUS.OSR2, regs.OSR[2] & 0xffff);
  Atomics.store(s, STATUS.OSR3, regs.OSR[3] & 0xffff);
}

function slice(): void {
  if (!running) return;
  frame++;

  if (Atomics.load(board.ctrl, CTRL.DMA_BUSY) === 0) {
    for (let i = 0; i < stepsPerSlice; i++) {
      tickCpu();
    }
  }

  publishStatus();
  timer = setTimeout(slice, sliceMs);
}

function start(): void {
  if (running) return;
  running = true;
  Atomics.store(board.ctrl, CTRL.CPU_RUNNING, 1);
  publishStatus();
  timer = setTimeout(slice, sliceMs);
  parentPort?.postMessage({ type: "cpu:started" });
}

function stop(): void {
  running = false;
  Atomics.store(board.ctrl, CTRL.CPU_RUNNING, 0);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  parentPort?.postMessage({ type: "cpu:stopped" });
}

parentPort?.on(
  "message",
  (msg: { type: string; port?: MessagePort }) => {
    if (msg?.type === "start") start();
    else if (msg?.type === "stop") stop();
    else if (msg?.type === "link:port" && msg.port) {
      attachCpuBoardLink(msg.port, dma);
    } else if (msg?.type === "dma:port" && msg.port) {
      // 互換: 旧名
      attachCpuBoardLink(msg.port, dma);
    }
  },
);

parentPort?.postMessage({ type: "cpu:ready" });
