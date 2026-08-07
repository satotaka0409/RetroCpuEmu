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

export type EmuHostOptions = {
  cpuStepsPerSlice?: number;
  cpuSliceMs?: number;
  ioSliceMs?: number;
  workerDir: string;
};

type Listener = (snap: EmuSnapshot) => void;

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

  constructor(opts: EmuHostOptions) {
    this.opts = opts;
    this.board = createSharedBoard();
  }

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
      },
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  keyHex(digit: string): void {
    this.io?.postMessage({ type: "key:hex", digit });
  }

  keyFn(fn: string): void {
    this.io?.postMessage({ type: "key:fn", fn });
  }

  /** Cursor からの Intel HEX → IO 経由 DMA 書き込み */
  loadIntelHex(hex: string): Promise<{ bytesWritten: number }> {
    if (!this.io) return Promise.reject(new Error("IO worker not started"));
    const id = hexReqId++;
    return new Promise((resolve, reject) => {
      this.hexWaiters.set(id, { resolve, reject });
      this.io!.postMessage({ type: "mem:loadIntelHex", hex, id });
    });
  }

  private notify(snap: EmuSnapshot): void {
    this.latest = snap;
    for (const cb of this.listeners) cb(snap);
  }

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
      },
    });
    this.io = new Worker(path.join(this.opts.workerDir, "io_worker.js"), {
      workerData: {
        ...shared,
        sliceMs: this.opts.ioSliceMs ?? 16,
      },
    });

    this.cpu.on("error", (err) => console.error("[cpu_worker]", err));
    this.io.on("error", (err) => console.error("[io_worker]", err));

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
          if (msg.ok) w.resolve({ bytesWritten: msg.bytesWritten ?? 0 });
          else w.reject(new Error(msg.error ?? "HEX load failed"));
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
  }

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
  }
}

function waitMessage(worker: Worker, type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMsg = (msg: { type?: string }) => {
      if (msg?.type === type) {
        worker.off("message", onMsg);
        worker.off("error", onErr);
        resolve();
      }
    };
    const onErr = (err: Error) => {
      worker.off("message", onMsg);
      worker.off("error", onErr);
      reject(err);
    };
    worker.on("message", onMsg);
    worker.on("error", onErr);
  });
}
