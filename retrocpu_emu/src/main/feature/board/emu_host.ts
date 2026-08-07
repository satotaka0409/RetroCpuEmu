/**
 * Electron メインから CPU / IO ワーカを起動するホスト
 *
 * RAM は CPU Worker 専有。
 * キーボード R/W → ハンドシェイク RPC、Cursor HEX → DMA。
 */

import { Worker, MessageChannel } from "node:worker_threads";
import path from "node:path";
import { createSharedBoard, type SharedBoard } from "./shared_board";
import type { EmuSnapshot } from "./emu_types";
import { getLogger } from "../log/logger";

export type EmuHostOptions = {
  cpuStepsPerSlice?: number;
  cpuSliceMs?: number;
  ioSliceMs?: number;
  workerDir: string;
  /** Worker にも渡すログ出力先 */
  logDir?: string;
};

type Listener = (snap: EmuSnapshot) => void;

const log = getLogger("host");

let hexReqId = 1;

export class EmuHost {
  private board: SharedBoard;
  private cpu: Worker | null = null;
  private io: Worker | null = null;
  private listeners = new Set<Listener>();
  private latest: EmuSnapshot | null = null;
  private readonly opts: EmuHostOptions;
  private hexWaiters = new Map<
    number,
    {
      resolve: (r: { bytesWritten: number }) => void;
      reject: (e: Error) => void;
    }
  >();

  /**
   * @param opts Worker の配置先やスライス間隔、ログ出力先
   */
  constructor(opts: EmuHostOptions) {
    this.opts = opts;
    this.board = createSharedBoard();
  }

  /**
   * 最新スナップショットを返す。
   * @returns IO Worker から届いた最新値。未受信なら初期値（idle / 全消灯）
   */
  getSnapshot(): EmuSnapshot {
    if (this.latest) return this.latest;
    return {
      status: "idle",
      regs: {
        R: [0, 0, 0, 0, 0],
        SP: 0,
        STR: 0,
        IC: 0,
        CSBR: 0,
        SSBR: 0,
        TSR0: 0,
        TSR1: 0,
        OSR: [0, 0, 0, 0],
        NPP: 0,
        IISR: 0,
        SBRB: 0,
        ICB: 0,
      },
      pins: {
        HLT: false,
        RUN: false,
        RST: false,
        IRQ0: false,
        IRQ1: false,
        IRQ2: false,
        BSAV: false,
        STRT: false,
        BSRQ: false,
        IOP: false,
        WRT: false,
      },
      memRows: [],
      frame: 0,
      led: {
        sevenSeg: Array.from({ length: 12 }, () => 0),
        bulletLed0_7: 0,
        bulletLed8_F: 0,
      },
      console: {
        wordAddr: 0,
        dataWord: 0,
        focus: "addr",
        halted: true,
        undefInsn: false,
      },
    };
  }

  /**
   * スナップショット更新を購読する。登録直後に現在値で 1 回呼ぶ。
   * @param listener 更新コールバック
   * @returns 購読解除する関数
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 16進キー押下を IO Worker へ送る。
   * @param digit "0"〜"F"
   */
  keyHex(digit: string): void {
    log.debug("16進キー", { digit });
    this.io?.postMessage({ type: "key:hex", digit });
  }

  /**
   * ファンクションキー押下を IO Worker へ送る。
   * @param fn "F0"〜"F7"（ADS / RD / INC / DEC / WINC / RUN / H-ST / RST）
   */
  keyFn(fn: string): void {
    log.debug("ファンクションキー", { fn });
    this.io?.postMessage({ type: "key:fn", fn });
  }

  /**
   * Cursor からの Intel HEX を IO 経由の DMA で CPU RAM へ書く。
   * @param hex Intel HEX テキスト
   * @returns 書き込んだバイト数
   */
  loadIntelHex(hex: string): Promise<{ bytesWritten: number }> {
    if (!this.io) return Promise.reject(new Error("IO worker not started"));
    const id = hexReqId++;
    log.info("Intel HEX ロードを依頼", { id, hexLength: hex.length });
    return new Promise((resolve, reject) => {
      this.hexWaiters.set(id, { resolve, reject });
      this.io!.postMessage({ type: "mem:loadIntelHex", hex, id });
    });
  }

  /**
   * 最新スナップショットを保存し購読者へ配る。
   * @param snap IO Worker から届いたスナップショット
   */
  private notify(snap: EmuSnapshot): void {
    this.latest = snap;
    for (const cb of this.listeners) cb(snap);
  }

  /**
   * CPU / IO Worker を起動し、ready を待って MessageChannel で相互接続する。
   * 既に起動済みなら何もしない。
   */
  async start(): Promise<void> {
    if (this.cpu || this.io) return;

    const shared = {
      control: this.board.control,
      status: this.board.status,
    };

    this.cpu = new Worker(path.join(this.opts.workerDir, "cpu_worker.js"), {
      workerData: {
        ...shared,
        stepsPerSlice: this.opts.cpuStepsPerSlice ?? 32,
        sliceMs: this.opts.cpuSliceMs ?? 4,
        logDir: this.opts.logDir,
      },
    });
    this.io = new Worker(path.join(this.opts.workerDir, "io_worker.js"), {
      workerData: {
        ...shared,
        sliceMs: this.opts.ioSliceMs ?? 16,
        logDir: this.opts.logDir,
      },
    });

    this.cpu.on("error", (err) =>
      log.error("CPU Worker エラー", { err: err.message, stack: err.stack }),
    );
    this.io.on("error", (err) =>
      log.error("IO Worker エラー", { err: err.message, stack: err.stack }),
    );

    this.io.on(
      "message",
      (msg: {
        type: string;
        snapshot?: EmuSnapshot;
        id?: number;
        ok?: boolean;
        bytesWritten?: number;
        error?: string;
      }) => {
        if (msg?.type === "io:snapshot" && msg.snapshot) {
          this.notify(msg.snapshot);
        } else if (msg?.type === "mem:loadIntelHex:result" && msg.id != null) {
          const w = this.hexWaiters.get(msg.id);
          if (!w) return;
          this.hexWaiters.delete(msg.id);
          if (msg.ok) {
            log.info("Intel HEX ロード完了", {
              id: msg.id,
              bytesWritten: msg.bytesWritten ?? 0,
            });
            w.resolve({ bytesWritten: msg.bytesWritten ?? 0 });
          } else {
            log.error("Intel HEX ロード失敗", { id: msg.id, err: msg.error });
            w.reject(new Error(msg.error ?? "HEX load failed"));
          }
        }
      },
    );

    await Promise.all([
      waitMessage(this.cpu, "cpu:ready"),
      waitMessage(this.io, "io:ready"),
    ]);

    const { port1, port2 } = new MessageChannel();
    this.cpu.postMessage({ type: "link:port", port: port1 }, [port1]);
    this.io.postMessage({ type: "link:port", port: port2 }, [port2]);

    this.cpu.postMessage({ type: "start" });
    this.io.postMessage({ type: "start" });
    log.info("CPU / IO Worker を起動した");
  }

  /** 両 Worker に停止を通知して terminate する */
  async stop(): Promise<void> {
    const cpu = this.cpu;
    const io = this.io;
    this.cpu = null;
    this.io = null;
    if (cpu) {
      cpu.postMessage({ type: "stop" });
      await cpu.terminate();
    }
    if (io) {
      io.postMessage({ type: "stop" });
      await io.terminate();
    }
    log.info("CPU / IO Worker を停止した");
  }
}

/**
 * Worker から特定種別のメッセージが来るまで待つ。
 * @param worker 監視対象 Worker
 * @param type 待ち受けるメッセージの type（例 "io:ready"）
 * @returns 受信で解決、Worker エラーで reject する Promise
 */
function waitMessage(worker: Worker, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    /** 目的の type なら購読を解除して解決する */
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === type) {
        worker.off("message", onMsg);
        worker.off("error", onErr);
        resolve();
      }
    };
    /** Worker エラーなら購読を解除して reject する */
    const onErr = (err: Error) => {
      worker.off("message", onMsg);
      worker.off("error", onErr);
      reject(err);
    };
    worker.on("message", onMsg);
    worker.on("error", onErr);
  });
}
