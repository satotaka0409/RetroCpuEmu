/**
 * IO ボード Worker（1階相当）
 * - ファンクションキー／16進コンソール（ioboard.mdc）
 * - メモリ R/W はハンドシェイク（50h/51h）
 * - Cursor の Intel HEX は DMA 書き込み
 */

import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import {
  attachSharedBoard,
  CTRL,
  EXEC_CODE,
  STATUS,
  type SharedBoard,
} from "../main/feature/board/shared_board";
import {
  setCpuToIoRequest,
  tickIoBoard,
} from "../main/feature/board/io_board";
import { getLedDisplayWire, resetLedDisplay } from "../main/feature/board/io_led";
import { BoardLinkClient } from "../main/feature/board/board_link_client";
import {
  IoConsole,
  type ConsoleFnKey,
} from "../main/feature/board/io_console";
import { loadIntelHex } from "../main/feature/code_test/intel_hex";
import { MEM_BYTES } from "../main/feature/board/shared_board";
import type { EmuSnapshot } from "../main/feature/board/emu_types";

type WorkerInit = {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  sliceMs?: number;
};

const init = workerData as WorkerInit;
const board: SharedBoard = attachSharedBoard(init);
const sliceMs = init.sliceMs ?? 16;
const link = new BoardLinkClient();

resetLedDisplay();

const consolePanel = new IoConsole({
  async memReadWord(wordAddr) {
    const bytes = await link.memReadBytes(wordAddr, 2);
    return ((bytes[0]! << 8) | bytes[1]!) & 0xffff;
  },
  async memWriteWord(wordAddr, word) {
    const hi = (word >>> 8) & 0xff;
    const lo = word & 0xff;
    await link.memWriteBytes(wordAddr, new Uint8Array([hi, lo]));
  },
  async exec(wordAddr) {
    await link.exec(wordAddr);
  },
  async setHalt(halt) {
    await link.setHalt(halt);
  },
  async pulseReset() {
    await link.pulseReset();
  },
  isHalted() {
    return Atomics.load(board.stat, STATUS.EXEC) !== EXEC_CODE.running;
  },
});

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ioFrame = 0;

function execStatus(): EmuSnapshot["status"] {
  switch (Atomics.load(board.stat, STATUS.EXEC)) {
    case EXEC_CODE.running:
      return "running";
    case EXEC_CODE.halted:
      return "halted";
    case EXEC_CODE.breakpoint:
      return "break";
    default:
      return "idle";
  }
}

function buildSnapshot(): EmuSnapshot {
  const s = board.stat;
  const panel = consolePanel.getState();
  return {
    status: execStatus(),
    regs: {
      R: [
        Atomics.load(s, STATUS.R0) & 0xffff,
        Atomics.load(s, STATUS.R1) & 0xffff,
        Atomics.load(s, STATUS.R2) & 0xffff,
        Atomics.load(s, STATUS.R3) & 0xffff,
        Atomics.load(s, STATUS.R4) & 0xffff,
      ],
      SP: Atomics.load(s, STATUS.SP) & 0xffff,
      STR: Atomics.load(s, STATUS.STR) & 0xffff,
      IC: Atomics.load(s, STATUS.IC) & 0xffff,
      CSBR: Atomics.load(s, STATUS.CSBR) & 0xffff,
      SSBR: Atomics.load(s, STATUS.SSBR) & 0xffff,
      TSR0: Atomics.load(s, STATUS.TSR0) & 0xffff,
      TSR1: Atomics.load(s, STATUS.TSR1) & 0xffff,
      OSR: [
        Atomics.load(s, STATUS.OSR0) & 0xffff,
        Atomics.load(s, STATUS.OSR1) & 0xffff,
        Atomics.load(s, STATUS.OSR2) & 0xffff,
        Atomics.load(s, STATUS.OSR3) & 0xffff,
      ],
      NPP: Atomics.load(s, STATUS.NPP) & 0xffff,
      IISR: Atomics.load(s, STATUS.IISR) & 0xffff,
      SBRB: Atomics.load(s, STATUS.SBRB) & 0xffff,
      ICB: Atomics.load(s, STATUS.ICB) & 0xffff,
    },
    pins: {
      HLT: Atomics.load(s, STATUS.HLT) !== 0,
      RUN: Atomics.load(s, STATUS.RUN) !== 0,
      RST: Atomics.load(s, STATUS.RST) !== 0,
      IRQ0: Atomics.load(s, STATUS.IRQ0) !== 0,
      IRQ1: Atomics.load(s, STATUS.IRQ1) !== 0,
      IRQ2: Atomics.load(s, STATUS.IRQ2) !== 0,
      BSAV: false,
      STRT: false,
      BSRQ: false,
      IOP: false,
      WRT: false,
    },
    memRows: [],
    frame: ioFrame,
    led: getLedDisplayWire(),
    console: panel,
  };
}

function slice(): void {
  if (!running) return;
  ioFrame++;

  setCpuToIoRequest(Atomics.load(board.ctrl, CTRL.CPU_TO_IO_REQ) !== 0);

  if (Atomics.load(board.ctrl, CTRL.DMA_BUSY) === 0) {
    tickIoBoard();
  }

  parentPort?.postMessage({ type: "io:snapshot", snapshot: buildSnapshot() });
  timer = setTimeout(slice, sliceMs);
}

function start(): void {
  if (running) return;
  running = true;
  Atomics.store(board.ctrl, CTRL.IO_RUNNING, 1);
  consolePanel.refreshLeds();
  timer = setTimeout(slice, sliceMs);
  parentPort?.postMessage({ type: "io:started" });
}

function stop(): void {
  running = false;
  Atomics.store(board.ctrl, CTRL.IO_RUNNING, 0);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  parentPort?.postMessage({ type: "io:stopped" });
}

async function loadHex(hex: string): Promise<{ bytesWritten: number }> {
  const buf = new Uint8Array(MEM_BYTES);
  const result = loadIntelHex(hex, buf);
  if (result.bytesWritten <= 0 || !Number.isFinite(result.minAddr)) {
    return { bytesWritten: 0 };
  }
  const slice = buf.subarray(result.minAddr, result.maxAddr + 1);
  await link.writeBytes(result.minAddr, slice);
  return { bytesWritten: result.bytesWritten };
}

parentPort?.on(
  "message",
  (msg: {
    type: string;
    port?: MessagePort;
    digit?: string;
    fn?: ConsoleFnKey;
    hex?: string;
    id?: number;
  }) => {
    if (msg?.type === "start") start();
    else if (msg?.type === "stop") stop();
    else if (
      (msg?.type === "link:port" || msg?.type === "dma:port") &&
      msg.port
    ) {
      link.attach(msg.port);
    } else if (msg?.type === "getSnapshot") {
      parentPort?.postMessage({
        type: "io:snapshot",
        snapshot: buildSnapshot(),
        reply: true,
      });
    } else if (msg?.type === "key:hex" && msg.digit) {
      consolePanel.onHex(msg.digit);
    } else if (msg?.type === "key:fn" && msg.fn) {
      void consolePanel.onFunction(msg.fn).catch((e) => {
        console.error("[io_console]", e);
      });
    } else if (msg?.type === "mem:loadIntelHex" && typeof msg.hex === "string") {
      void loadHex(msg.hex)
        .then((r) =>
          parentPort?.postMessage({
            type: "mem:loadIntelHex:result",
            id: msg.id,
            ok: true,
            ...r,
          }),
        )
        .catch((e: unknown) =>
          parentPort?.postMessage({
            type: "mem:loadIntelHex:result",
            id: msg.id,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
    }
  },
);

parentPort?.postMessage({ type: "io:ready" });
