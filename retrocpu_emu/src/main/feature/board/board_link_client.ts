/**
 * IO → CPU ボードリンククライアント（DMA + ハンドシェイク RPC）
 */

import type { MessagePort } from "node:worker_threads";
import {
  CMD_IO_TO_CPU,
  type BoardLinkRequest,
  type BoardLinkResponse,
} from "./board_link";

type Pending = {
  resolve: (data?: ArrayBuffer) => void;
  reject: (err: Error) => void;
};

export class BoardLinkClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private port: MessagePort | null = null;

  attach(port: MessagePort): void {
    this.port?.close();
    this.port = port;
    port.on("message", (msg: BoardLinkResponse) => {
      if (!msg || msg.type !== "link:result") return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error ?? "board link failed"));
    });
    port.start();
  }

  async writeBytes(byteAddr: number, data: Uint8Array): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const ab = copy.buffer as ArrayBuffer;
    const req: BoardLinkRequest = {
      type: "dma:writeBytes",
      id,
      byteAddr: byteAddr >>> 0,
      data: ab,
    };
    await this.send(port, req, [ab]);
  }

  async memReadBytes(wordAddr: number, byteCount: number): Promise<Uint8Array> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.MEM_READ,
      wordAddr: wordAddr >>> 0,
      byteCount: byteCount >>> 0,
    };
    const data = await this.send(port, req);
    return new Uint8Array(data ?? new ArrayBuffer(0));
  }

  async memWriteBytes(wordAddr: number, data: Uint8Array): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const ab = copy.buffer as ArrayBuffer;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.MEM_WRITE,
      wordAddr: wordAddr >>> 0,
      data: ab,
    };
    await this.send(port, req, [ab]);
  }

  async exec(wordAddr: number): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.EXEC,
      wordAddr: wordAddr >>> 0,
    };
    await this.send(port, req);
  }

  async setHalt(halt: boolean): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = { type: "cpu:setHalt", id, halt };
    await this.send(port, req);
  }

  async pulseReset(): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = { type: "cpu:pulseReset", id };
    await this.send(port, req);
  }

  private send(
    port: MessagePort,
    req: BoardLinkRequest,
    transfer?: ArrayBuffer[],
  ): Promise<ArrayBuffer | undefined> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, {
        resolve: (data) => resolve(data),
        reject,
      });
      if (transfer) port.postMessage(req, transfer);
      else port.postMessage(req);
    });
  }

  private requirePort(): MessagePort {
    if (!this.port) throw new Error("board link port not attached");
    return this.port;
  }
}
