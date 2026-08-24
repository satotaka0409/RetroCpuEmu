/**
 * CPU 側ボードリンク処理
 *
 * - DMA（`dma:write*`）: IO→CPU RAM **書き込み専用**。read は拒否（ioboard.mdc）
 * - ハンドシェイク（`hshk` 13h/14h）: パネル RD/INC/DEC/WINC。線上プロトコルで
 *   ブートモニタの `gl_hshk_read_memory` / `gl_hshk_write_memory` が RAM を触る
 * - 12h EXEC: モニタ未実装のため IC 設定＋ startRun（スタブ）
 */

import type { MessagePort } from "node:worker_threads";
import {
  CMD_IO_TO_CPU,
  type BoardLinkRequest,
  type BoardLinkResponse,
  type CpuToIoFrameRequest,
  type CpuToIoFrameResponse,
} from "../shared/board_link";
import { CPU_TYPE } from "../ioboard/setting_area";
import type { CpuHandshakeAgent } from "./cpu_hshk_agent";
import { pulseCpuReset } from "./boot";
import { getCpuCore } from "./cpu_core";
import {
  getInterruptBusy,
  isHandshakeActive,
  setCpuPortMode,
  setResetVector,
  setIntCause,
} from "./io_ports";
import { IO_PORT_STEP_DELAY, stepBreak } from "./mn1613/step_break";

let _linkCpuType = 1;
let _clockDiv = 0;

/** ボードリンクが使う CPU 種別を設定する */
export function setBoardLinkCpuType(cpuType: number): void {
  _linkCpuType = cpuType;
}

/** ボードリンクから設定されたクロック分周比を返す（0:1/1, 1:1/2, 2:1/4, 3:1/8）。 */
export function getBoardLinkClockDiv(): number {
  return _clockDiv & 0x03;
}

function core() {
  return getCpuCore(_linkCpuType);
}

/**
 * パネル／リンク上のアドレスをハンドシェイク 13h/14h 用バイトアドレスへ変換する。
 * MN1613 はワードアドレス、TMS9995 はバイトアドレス（HandShake.mdc）。
 * @param panelAddr リンク `wordAddr` フィールドの値
 */
function panelAddrToByteAddr(panelAddr: number): number {
  if (_linkCpuType === CPU_TYPE.TMS9995) {
    return panelAddr >>> 0;
  }
  return (panelAddr >>> 0) * 2;
}

/** 割り込み処理中で配送できないときの再試行間隔 (ms) */
const IRQ_RETRY_MS = 1;

/** 再試行の上限回数（超えたら要因を上書きして配送する） */
const IRQ_RETRY_MAX = 200;

/** CPU→IO フレーム転送の応答待ち */
type FramePending = {
  resolve: (response: Uint8Array) => void;
  reject: (err: Error) => void;
};

type DmaWriteTarget = {
  writeBytes(byteAddr: number, data: Uint8Array): Promise<void>;
  writeWords(wordAddr: number, words: number[]): Promise<void>;
};

let _linkPort: MessagePort | null = null;
let _hshkAgent: CpuHandshakeAgent | null = null;
let _frameId = 1;
const _framePending = new Map<number, FramePending>();

/**
 * IO ボードからのリンク要求を受け付けるようポートを開く。
 * @param port IO Worker と対になる MessagePort
 * @param dma DMA 書き込み先（CPU 側 RAM。読み込み API なし）
 * @param hshk 13h/14h を線上ハンドシェイクで処理するエージェント（省略時は 13h/14h NG）
 */
export function attachCpuBoardLink(
  port: MessagePort,
  dma: DmaWriteTarget,
  hshk?: CpuHandshakeAgent,
): void {
  _linkPort = port;
  _hshkAgent = hshk ?? null;
  port.on(
    "message",
    (msg: BoardLinkRequest | CpuToIoFrameResponse | unknown) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as CpuToIoFrameResponse).type === "cpuio:result"
      ) {
        settleFrame(msg as CpuToIoFrameResponse);
        return;
      }
      void handle(msg, port, dma);
    },
  );
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
 * リンク要求として扱えるか（type と id があるか）を見る。
 * @param msg 受信メッセージ
 */
function isLinkEnvelope(msg: unknown): msg is { type: string; id: number } {
  return (
    !!msg &&
    typeof msg === "object" &&
    typeof (msg as { id?: unknown }).id === "number" &&
    typeof (msg as { type?: unknown }).type === "string"
  );
}

/**
 * リンク要求 1 件を処理して結果を返す。例外は NG 応答に変換する。
 * @param msg 受信したリクエスト（id を持たないものは無視）
 * @param port 応答を返すポート
 * @param dma DMA 書き込み先（読み込み不可）
 */
async function handle(
  msg: unknown,
  port: MessagePort,
  dma: DmaWriteTarget,
): Promise<void> {
  if (!isLinkEnvelope(msg)) return;
  const id = msg.id;
  const type = msg.type;
  try {
    if (type === "dma:writeBytes") {
      const m = msg as Extract<BoardLinkRequest, { type: "dma:writeBytes" }>;
      await dma.writeBytes(m.byteAddr, new Uint8Array(m.data));
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "dma:writeWords") {
      const m = msg as Extract<BoardLinkRequest, { type: "dma:writeWords" }>;
      await dma.writeWords(m.wordAddr, m.words);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type.startsWith("dma:")) {
      reply(port, {
        type: "link:result",
        id,
        ok: false,
        error: "DMA is write-only (ioboard.mdc); use handshake 13h to read",
      });
      return;
    }
    if (type === "cpu:setHalt") {
      const m = msg as Extract<BoardLinkRequest, { type: "cpu:setHalt" }>;
      if (m.halt) {
        core().setPins({ HLT: true });
        core().requestHalt();
      } else {
        core().setPins({ HLT: false });
        if (core().getExecStatus() !== "running") {
          core().startRun();
        }
      }
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "cpu:pulseReset") {
      const m = msg as Extract<BoardLinkRequest, { type: "cpu:pulseReset" }>;
      if (typeof m.resetVectorWord === "number") {
        setResetVector(m.resetVectorWord & 0xffff);
      }
      core().setPins({ HLT: false });
      pulseCpuReset(_linkCpuType);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "cpu:setCpuType") {
      const m = msg as Extract<BoardLinkRequest, { type: "cpu:setCpuType" }>;
      _linkCpuType = m.cpuType & 0xff;
      setCpuPortMode(m.cpuType);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "cpu:setStepDelay") {
      const m = msg as Extract<BoardLinkRequest, { type: "cpu:setStepDelay" }>;
      stepBreak.writePort(IO_PORT_STEP_DELAY, m.stepDelay & 0xff);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "cpu:setClockDiv") {
      const m = msg as Extract<BoardLinkRequest, { type: "cpu:setClockDiv" }>;
      _clockDiv = m.clockDiv & 0x03;
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "cpu:irq") {
      const m = msg as Extract<BoardLinkRequest, { type: "cpu:irq" }>;
      deliverInterrupt(m.level, m.cause);
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (type === "hshk") {
      await handleHshk(
        msg as Extract<BoardLinkRequest, { type: "hshk" }>,
        port,
      );
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
 * 割り込み処理中（INTERRUPT_BUSY=1）やハンドシェイク線が動作中は
 * INT_CAUSE の取り違えを避けるため少し待って再試行し、
 * 上限を超えたら要因を上書きして配送する。
 * 要求は取り下げず、必ず 1 回配送する（レベル線相当）。
 * @param level 割り込みレベル（0〜2）
 * @param cause 割り込み要因（INT_CAUSE_CODE）
 * @param attempt 現在の再試行回数
 */
function deliverInterrupt(level: 0 | 1 | 2, cause: number, attempt = 0): void {
  const busy = getInterruptBusy() === 1 || isHandshakeActive();
  if (busy && attempt < IRQ_RETRY_MAX) {
    setTimeout(() => deliverInterrupt(level, cause, attempt + 1), IRQ_RETRY_MS);
    return;
  }
  setIntCause(cause);
  if (level === 0) {
    core().setPins({ IRQ0: true });
    core().triggerInterrupt(0);
    core().setPins({ IRQ0: false });
    return;
  }
  if (level === 1) {
    core().setPins({ IRQ1: true });
    core().triggerInterrupt(1);
    core().setPins({ IRQ1: false });
    return;
  }
  core().setPins({ IRQ2: true });
  core().triggerInterrupt(2);
  core().setPins({ IRQ2: false });
}

/**
 * ハンドシェイクコマンド（MEM_READ / MEM_WRITE / EXEC）を処理する。
 * 13h/14h は DMA ではなく線上ハンドシェイク（ブートモニタ IRQ）。
 * @param msg hshk 種別のリクエスト
 * @param port 応答を返すポート
 */
async function handleHshk(
  msg: Extract<BoardLinkRequest, { type: "hshk" }>,
  port: MessagePort,
): Promise<void> {
  const id = msg.id;
  const cmd = msg.cmd;

  if (cmd === CMD_IO_TO_CPU.MEM_READ && "byteCount" in msg) {
    if (!_hshkAgent) {
      reply(port, {
        type: "link:result",
        id,
        ok: false,
        error: "handshake agent not attached; cannot MEM_READ via 13h",
      });
      return;
    }
    const bytes = await _hshkAgent.memRead(
      panelAddrToByteAddr(msg.wordAddr >>> 0),
      msg.byteCount >>> 0,
    );
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
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
    if (!_hshkAgent) {
      reply(port, {
        type: "link:result",
        id,
        ok: false,
        error: "handshake agent not attached; cannot MEM_WRITE via 14h",
      });
      return;
    }
    await _hshkAgent.memWrite(
      panelAddrToByteAddr(msg.wordAddr >>> 0),
      new Uint8Array(msg.data),
    );
    reply(port, { type: "link:result", id, ok: true });
    return;
  }

  if (cmd === CMD_IO_TO_CPU.EXEC) {
    core().setPins({ HLT: false });
    core().setState({ IC: msg.wordAddr & 0xffff });
    core().startRun();
    reply(port, { type: "link:result", id, ok: true });
    return;
  }

  if (cmd === CMD_IO_TO_CPU.BREAK_MEM_IO_SET && "payload" in msg) {
    if (!_hshkAgent) {
      reply(port, {
        type: "link:result",
        id,
        ok: false,
        error: "handshake agent not attached; cannot 10h",
      });
      return;
    }
    const status = await _hshkAgent.addrBreakSet(new Uint8Array(msg.payload));
    const ab = Uint8Array.from([status & 0xff]).buffer as ArrayBuffer;
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

  if (cmd === CMD_IO_TO_CPU.BREAK_MEM_IO_CLR && "slot" in msg) {
    if (!_hshkAgent) {
      reply(port, {
        type: "link:result",
        id,
        ok: false,
        error: "handshake agent not attached; cannot 11h",
      });
      return;
    }
    const status = await _hshkAgent.addrBreakClr(msg.slot);
    const ab = Uint8Array.from([status & 0xff]).buffer as ArrayBuffer;
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
