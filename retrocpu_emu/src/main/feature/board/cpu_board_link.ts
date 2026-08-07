/**
 * CPU 側ボードリンク処理（DMA + ハンドシェイク相当）
 * モニタ未実装時の最小 BIOS スタブとして、HALT 中でも R/W・EXEC を受け付ける。
 */

import type { MessagePort } from "node:worker_threads";
import {
  CMD_IO_TO_CPU,
  type BoardLinkRequest,
  type BoardLinkResponse,
} from "./board_link";
import { CpuDmaTarget } from "./cpu_dma";
import {
  getExecStatus,
  getMemory,
  getPins,
  setPins,
  setState,
  startRun,
} from "../cpu/mn1613/mn1613";
import { pulseCpuReset } from "./boot";

export function attachCpuBoardLink(
  port: MessagePort,
  dma: CpuDmaTarget,
): void {
  port.on("message", (msg: BoardLinkRequest) => {
    void handle(msg, port, dma);
  });
  port.start();
}

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
      setPins({ HLT: msg.halt });
      if (!msg.halt && getExecStatus() !== "running") {
        startRun();
      }
      reply(port, { type: "link:result", id, ok: true });
      return;
    }
    if (msg.type === "cpu:pulseReset") {
      pulseCpuReset();
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

function reply(port: MessagePort, res: BoardLinkResponse): void {
  port.postMessage(res);
}
