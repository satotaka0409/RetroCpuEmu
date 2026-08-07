/**
 * CPU 側ボードリンク処理（DMA + ハンドシェイク相当）
 * モニタ未実装時の最小 BIOS スタブとして、HALT 中でも R/W・EXEC を受け付ける。
 */

import type { MessagePort } from "node:worker_threads";
import {
  CMD_IO_TO_CPU,
  type BoardLinkRequest,
  type BoardLinkResponse,
  type CpuToIoFrameRequest,
  type CpuToIoFrameResponse,
} from "./board_link";
import { CpuDmaTarget } from "./cpu_dma";
import {
  getExecStatus,
  getMemory,
  getPins,
  requestHalt,
  setPins,
  setState,
  startRun,
  triggerInterrupt,
} from "../cpu/mn1613/mn1613";
import { pulseCpuReset } from "./boot";
import {
  getInterruptBusy,
  isHandshakeActive,
  setIntCause,
} from "./io_ports";

/** 割り込み処理中で配送できないときの再試行間隔 (ms) */
const IRQ_RETRY_MS = 1;

/** 再試行の上限回数（超えたら要因を上書きして配送する） */
const IRQ_RETRY_MAX = 200;

/** CPU→IO フレーム転送の応答待ち */
type FramePending = {
  resolve: (response: Uint8Array) => void;
  reject: (err: Error) => void;
};

let _linkPort: MessagePort | null = null;
let _frameId = 1;
const _framePending = new Map<number, FramePending>();

/**
 * IO ボードからのリンク要求を受け付けるようポートを開く。
 * @param port IO Worker と対になる MessagePort
 * @param dma DMA 書き込み先（CPU 側 RAM）
 */
export function attachCpuBoardLink(
  port: MessagePort,
  dma: CpuDmaTarget,
): void {
  _linkPort = port;
  port.on("message", (msg: BoardLinkRequest | CpuToIoFrameResponse) => {
    if (msg?.type === "cpuio:result") {
      settleFrame(msg);
      return;
    }
    void handle(msg, port, dma);
  });
  port.start();
}

/**
 * CPU→IO コマンドのフレームを IO ボードへ転送し、応答を待つ。
 * @param frame コマンドバイトを含む送信済みフレーム
 * @returns CPU へ返す応答バイト列（無応答コマンドなら長さ 0）
 * @throws ポート未接続、または IO ボードがエラーを返した場合
 */
export function sendCpuToIoFrame(frame: Uint8Array): Promise<Uint8Array> {
  const port = _linkPort;
  if (!port) {
    return Promise.reject(new Error("board link port not attached"));
  }
  const id = _frameId++;
  const copy = new Uint8Array(frame.byteLength);
  copy.set(frame);
  const ab = copy.buffer as ArrayBuffer;
  return new Promise<Uint8Array>((resolve, reject) => {
    _framePending.set(id, { resolve, reject });
    const req: CpuToIoFrameRequest = { type: "cpuio:frame", id, frame: ab };
    port.postMessage(req, [ab]);
  });
}

/**
 * CPU→IO フレーム転送の応答を待ち受け側へ渡す。
 * @param msg 受信した応答メッセージ
 */
function settleFrame(msg: CpuToIoFrameResponse): void {
  const pending = _framePending.get(msg.id);
  if (!pending) return;
  _framePending.delete(msg.id);
  if (msg.ok) {
    pending.resolve(new Uint8Array(msg.response ?? new ArrayBuffer(0)));
  } else {
    pending.reject(new Error(msg.error ?? "cpu to io frame failed"));
  }
}

/**
 * リンク要求 1 件を処理して結果を返す。例外は NG 応答に変換する。
 * @param msg 受信したリクエスト（id を持たないものは無視）
 * @param port 応答を返すポート
 * @param dma DMA 書き込み先
 */
async function handle(
  msg: BoardLinkRequest,
  port: MessagePort,
  dma: CpuDmaTarget,
): Promise<void> {
  if (!msg || typeof (msg as { id?: number }).id !== "number") return;
  const id = msg.id;
  try {
    if (msg.type === "dma:writeBytes") {
      await dma.writeBytes(msg.byteAddr, new Uint8Array(msg.data));
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (msg.type === "dma:writeWords") {
      await dma.writeWords(msg.wordAddr, msg.words);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (msg.type === "cpu:setHalt") {
      if (msg.halt) {
        setPins({ HLT: true });
        requestHalt();
      } else {
        setPins({ HLT: false });
        if (getExecStatus() !== "running") {
          startRun();
        }
      }
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (msg.type === "cpu:pulseReset") {
      pulseCpuReset();
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (msg.type === "cpu:irq") {
      deliverInterrupt(msg.level, msg.cause);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (msg.type === "hshk") {
      await handleHshk(msg, port);
      return;
    }
    reply(port, {
      type: "link:result",
      id,
      ok: false,
      error: "unknown request",
    });
  } catch (e) {
    reply(port, {
      type: "link:result",
      id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * IO ボード発の割り込みを CPU へ配送する。
 * 割り込み処理中（INTERRUPT_BUSY=1）やハンドシェイク転送中（HSHK_ENA=1）は
 * INT_CAUSE の取り違えを避けるため少し待って再試行し、
 * 上限を超えたら要因を上書きして配送する。
 * 要求は取り下げず、必ず 1 回配送する（レベル線相当）。
 * @param level 割り込みレベル（0〜2）
 * @param cause 割り込み要因（INT_CAUSE_CODE）
 * @param attempt 現在の再試行回数
 */
function deliverInterrupt(
  level: 0 | 1 | 2,
  cause: number,
  attempt = 0,
): void {
  const busy = getInterruptBusy() === 1 || isHandshakeActive();
  if (busy && attempt < IRQ_RETRY_MAX) {
    setTimeout(() => deliverInterrupt(level, cause, attempt + 1), IRQ_RETRY_MS);
    return;
  }
  setIntCause(cause);
  if (level === 0) {
    setPins({ IRQ0: true });
    triggerInterrupt(0);
    setPins({ IRQ0: false });
    return;
  }
  if (level === 1) {
    setPins({ IRQ1: true });
    triggerInterrupt(1);
    setPins({ IRQ1: false });
    return;
  }
  setPins({ IRQ2: true });
  triggerInterrupt(2);
  setPins({ IRQ2: false });
}

/**
 * ハンドシェイクコマンド（MEM_READ / MEM_WRITE / EXEC）を処理する。
 * モニタ未実装のため、実行中なら HLT を立ててから RAM を触る。
 * @param msg hshk 種別のリクエスト
 * @param port 応答を返すポート
 */
async function handleHshk(
  msg: Extract<BoardLinkRequest, { type: "hshk" }>,
  port: MessagePort,
): Promise<void> {
  const id = msg.id;
  const cmd = msg.cmd;
  if (getPins().RUN || getExecStatus() === "running") {
    setPins({ HLT: true });
  }

  if (cmd === CMD_IO_TO_CPU.MEM_READ && "byteCount" in msg) {
    const view = new DataView(getMemory());
    const out = new Uint8Array(msg.byteCount);
    const baseByte = (msg.wordAddr >>> 0) * 2;
    for (let i = 0; i < msg.byteCount; i++) {
      const off = baseByte + i;
      out[i] = off < view.byteLength ? view.getUint8(off) : 0;
    }
    const copy = new Uint8Array(out.byteLength);
    copy.set(out);
    const ab = copy.buffer as ArrayBuffer;
    port.postMessage(
      {
        type: "link:result",
        id,
        ok: true,
        data: ab,
      } satisfies BoardLinkResponse,
      [ab],
    );
    return;
  }

  if (cmd === CMD_IO_TO_CPU.MEM_WRITE && "data" in msg) {
    const view = new DataView(getMemory());
    const data = new Uint8Array(msg.data);
    const baseByte = (msg.wordAddr >>> 0) * 2;
    for (let i = 0; i < data.length; i++) {
      const off = baseByte + i;
      if (off < view.byteLength) view.setUint8(off, data[i]!);
    }
    reply(port, { type: "link:result", id, ok: true });
    return;
  }

  if (cmd === CMD_IO_TO_CPU.EXEC) {
    setPins({ HLT: false });
    setState({ IC: msg.wordAddr & 0xffff });
    startRun();
    reply(port, { type: "link:result", id, ok: true });
    return;
  }

  reply(port, {
    type: "link:result",
    id,
    ok: false,
    error: `unsupported hshk cmd 0x${Number(cmd).toString(16)}`,
  });
}

/**
 * 応答を送る（転送すべきバッファが無い場合の共通経路）。
 * @param port 応答先ポート
 * @param res 応答メッセージ
 */
function reply(port: MessagePort, res: BoardLinkResponse): void {
  port.postMessage(res);
}
