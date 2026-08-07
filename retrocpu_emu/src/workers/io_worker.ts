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
import { getLogger, initLogging } from "../main/feature/log/logger";
import { IoTimer } from "../main/feature/board/io_timer";
import {
  createDefaultCpuToIoHandlers,
  createIoBoardCommandState,
} from "../main/feature/board/handshake/io_board_mock";
import { CpuToIoCommandDispatcher } from "../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  intCauseForTimer,
} from "../main/feature/cpu/mn1613/handhshake/handshake_type";

type WorkerInit = {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  sliceMs?: number;
  logDir?: string;
};

const init = workerData as WorkerInit;
initLogging({ source: "io", dir: init.logDir });
const log = getLogger("io");
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
let lastExecStatus: EmuSnapshot["status"] | null = null;
let lastUndefInsn = false;

/**
 * タイマー満了をレベル 2 割り込みとして CPU ボードへ送る。
 * 割り込み要因はタイマー番号（0 / 1）。
 * @param timerNo 満了したタイマー番号
 */
function raiseTimerInterrupt(timerNo: 0 | 1): void {
  void link.raiseInterrupt(2, intCauseForTimer(timerNo)).catch((e: unknown) => {
    log.error("タイマー割り込みの配送に失敗", {
      timerNo,
      err: e instanceof Error ? e.message : String(e),
    });
  });
}

/**
 * IO ボードのタイマー 2 本（ハンドシェイク 19h のタイマー番号 0 / 1）。
 * 初期化直後は停止しており、19h を受けたときだけ動き出す。
 */
const intervalTimers: readonly [IoTimer, IoTimer] = [
  new IoTimer({ onExpire: () => raiseTimerInterrupt(0) }),
  new IoTimer({ onExpire: () => raiseTimerInterrupt(1) }),
];

/** CPU→IO コマンド（10h〜1ah）の状態と既定ハンドラ */
const cmdState = createIoBoardCommandState();
const cmdDispatcher = new CpuToIoCommandDispatcher(
  createDefaultCpuToIoHandlers(cmdState, intervalTimers),
);

link.setCpuToIoFrameHandler((frame) => {
  const cmd = frame[0] ?? 0;
  const response = cmdDispatcher.dispatch(frame);
  if (cmd === CMD_CPU_TO_IO.TIMER_SET) {
    const timerNo = frame[1] ?? 0;
    const state = intervalTimers[timerNo]?.getState();
    log.info("タイマー設定を受理 (19h)", {
      timerNo,
      periodMs: state?.periodMs ?? 0,
      count: state?.count ?? 0,
      running: state?.running ?? false,
      status: response[0],
    });
  } else {
    log.debug("CPU→IO コマンドを処理", {
      cmd: `0x${cmd.toString(16)}`,
      respLen: response.length,
    });
  }
  return response;
});

/**
 * 共有バッファの実行コードをスナップショット用の文字列に変換する。
 * @returns running / halted / break / idle
 */
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

/**
 * レンダラへ送る画面用スナップショットを組み立てる。
 * メモリ内容は含めない（RAM は CPU ボード専有のため）。
 * @returns 現在のレジスタ・ピン・LED・パネル状態
 */
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

/**
 * IO ボードの 1 スライス。ボード処理・CPU 状態の取り込み・スナップショット送信を行う。
 * DMA 中はボード処理を止める。
 */
function slice(): void {
  if (!running) return;
  ioFrame++;

  setCpuToIoRequest(Atomics.load(board.ctrl, CTRL.CPU_TO_IO_REQ) !== 0);

  if (Atomics.load(board.ctrl, CTRL.DMA_BUSY) === 0) {
    tickIoBoard();
  }

  const iisr = Atomics.load(board.stat, STATUS.IISR) & 0xffff;
  consolePanel.syncFromCpu(iisr);

  const status = execStatus();
  if (status !== lastExecStatus) {
    log.info("CPU 実行状態が変化", {
      from: lastExecStatus ?? "-",
      to: status,
      ic: Atomics.load(board.stat, STATUS.IC) & 0xffff,
    });
    lastExecStatus = status;
  }

  const undefInsn = (iisr & 0x8000) !== 0;
  if (undefInsn !== lastUndefInsn) {
    if (undefInsn) log.warn("未定義命令を検出（砲弾 B / UNDEF 点灯）", { iisr });
    lastUndefInsn = undefInsn;
  }

  parentPort?.postMessage({ type: "io:snapshot", snapshot: buildSnapshot() });
  timer = setTimeout(slice, sliceMs);
}

/** スライス実行を開始する（多重呼び出しは無視） */
function start(): void {
  if (running) return;
  running = true;
  Atomics.store(board.ctrl, CTRL.IO_RUNNING, 1);
  consolePanel.refreshLeds();
  timer = setTimeout(slice, sliceMs);
  log.info("IO Worker 開始", { sliceMs });
  parentPort?.postMessage({ type: "io:started" });
}

/** スライス実行とタイマー割り込みを止めてタイマーを解除する */
function stop(): void {
  running = false;
  Atomics.store(board.ctrl, CTRL.IO_RUNNING, 0);
  for (const t of intervalTimers) t.stop();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  log.info("IO Worker 停止");
  parentPort?.postMessage({ type: "io:stopped" });
}

/**
 * Intel HEX を展開し、使用範囲だけを DMA で CPU ボードの RAM へ書く。
 * @param hex Intel HEX テキスト
 * @returns 書き込んだバイト数（データが無ければ 0）
 */
async function loadHex(hex: string): Promise<{ bytesWritten: number }> {
  const buf = new Uint8Array(MEM_BYTES);
  const result = loadIntelHex(hex, buf);
  if (result.bytesWritten <= 0 || !Number.isFinite(result.minAddr)) {
    log.warn("Intel HEX に書き込むデータが無い");
    return { bytesWritten: 0 };
  }
  const slice = buf.subarray(result.minAddr, result.maxAddr + 1);
  log.info("DMA 書き込み開始", {
    minAddr: result.minAddr,
    maxAddr: result.maxAddr,
    bytes: slice.length,
  });
  await link.writeBytes(result.minAddr, slice);
  log.info("DMA 書き込み完了", { bytesWritten: result.bytesWritten });
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
      log.debug("CPU ボードリンクを接続", { type: msg.type });
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
      const fn = msg.fn;
      void consolePanel.onFunction(fn).catch((e: unknown) => {
        log.error("ファンクションキー処理に失敗", {
          fn,
          err: e instanceof Error ? e.message : String(e),
        });
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
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          log.error("Intel HEX ロードに失敗", { id: msg.id, err: error });
          parentPort?.postMessage({
            type: "mem:loadIntelHex:result",
            id: msg.id,
            ok: false,
            error,
          });
        });
    }
  },
);

log.info("IO Worker 準備完了");
parentPort?.postMessage({ type: "io:ready" });
