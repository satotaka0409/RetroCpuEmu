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
import {
  attachCpuBoardLink,
  sendCpuToIoFrame,
} from "../main/feature/board/cpu_board_link";
import { CpuHandshakeAgent } from "../main/feature/board/cpu_hshk_agent";
import { attachHandshakeBus } from "../main/feature/board/io_ports";
import { coldBootHaltStub } from "../main/feature/board/boot";
import {
  getExecStatus,
  getPins,
  getState,
  tickCpu,
} from "../main/feature/cpu/mn1613/mn1613";
import { getLogger, initLogging } from "../main/feature/log/logger";

type WorkerInit = {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  stepsPerSlice?: number;
  sliceMs?: number;
  logDir?: string;
};

const init = workerData as WorkerInit;
initLogging({ source: "cpu", dir: init.logDir });
const log = getLogger("cpu");
const board: SharedBoard = attachSharedBoard(init);
const stepsPerSlice = init.stepsPerSlice ?? 32;
const sliceMs = init.sliceMs ?? 4;

/**
 * CPU→IO ハンドシェイクの線側。組み立てたフレームは IO ボード Worker へ転送する。
 * attachIoBoardPorts() より前にバスを登録する必要があるため、boot より先に作る。
 */
const hshkAgent = new CpuHandshakeAgent({
  forward: (frame) => sendCpuToIoFrame(frame),
  onTransaction: (cmd, frame, response) => {
    log.debug("CPU→IO コマンドを転送", {
      cmd: `0x${cmd.toString(16)}`,
      frameLen: frame.length,
      respLen: response.length,
    });
  },
  onError: (err) => {
    log.error("CPU→IO ハンドシェイクに失敗", { err: err.message });
  },
});
attachHandshakeBus(hshkAgent.bus);

coldBootHaltStub();

const dma = new CpuDmaTarget(5000, {
  onBusy(busy) {
    Atomics.store(board.ctrl, CTRL.DMA_BUSY, busy ? 1 : 0);
  },
});

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let frame = 0;

/**
 * CPU の実行状態を共有バッファ用の数値コードに変換する。
 * @returns EXEC_CODE のいずれか（step は running 扱い）
 */
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

/** レジスタ・ピン・実行状態を共有バッファへ書き出す（IO Worker が読む） */
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

/**
 * 1 スライス分（stepsPerSlice 命令）実行して状態を公開し、次のスライスを予約する。
 * DMA 中は CPU を進めない。
 */
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

/** スライス実行を開始する（多重呼び出しは無視） */
function start(): void {
  if (running) return;
  running = true;
  Atomics.store(board.ctrl, CTRL.CPU_RUNNING, 1);
  hshkAgent.start();
  publishStatus();
  timer = setTimeout(slice, sliceMs);
  log.info("CPU Worker 開始", { stepsPerSlice, sliceMs });
  parentPort?.postMessage({ type: "cpu:started" });
}

/** スライス実行を止めてタイマーを解除する */
function stop(): void {
  running = false;
  Atomics.store(board.ctrl, CTRL.CPU_RUNNING, 0);
  void hshkAgent.stop();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  log.info("CPU Worker 停止");
  parentPort?.postMessage({ type: "cpu:stopped" });
}

parentPort?.on(
  "message",
  (msg: { type: string; port?: MessagePort }) => {
    if (msg?.type === "start") start();
    else if (msg?.type === "stop") stop();
    else if (
      (msg?.type === "link:port" || msg?.type === "dma:port") &&
      msg.port
    ) {
      // dma:port は旧名（互換）
      attachCpuBoardLink(msg.port, dma);
      hshkAgent.start();
    }
  },
);

log.info("CPU Worker 準備完了");
parentPort?.postMessage({ type: "cpu:ready" });
