/**
 * デバッグ TCP 13h/14h を製品経路（HALT→IRQ2）で中継する。
 * 根拠: HandShake.mdc / retrocpu_debug.mdc / cpu_slice.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import net from "node:net";
import { MessageChannel } from "node:worker_threads";
import { attachCpuBoardLink } from "../../src/cpuboard/cpu_board_link";
import { BoardLinkClient } from "../../src/ioboard/board_link_client";
import { CpuHandshakeAgent } from "../../src/cpuboard/cpu_hshk_agent";
import { CpuDmaTarget } from "../../src/cpuboard/cpu_dma";
import { pulseCpuReset } from "../../src/cpuboard/boot";
import {
  attachHandshakeBus,
  attachIoBoardPorts,
  MONITOR_ENTRY_WORD,
  setResetVector,
} from "../../src/cpuboard/io_ports";
import {
  getExecStatus,
  getMemory,
  getState,
  powerOnIdle,
  setMemory,
  setPins,
  tickCpu,
  STR_M2,
} from "../../src/cpuboard/mn1613/mn1613";
import {
  readBootMonitorDmaSlice,
  resolveBootMonitorHexCdbPair,
} from "../../src/ioboard/io_reset";
import { DebugHost } from "../../src/ioboard/debug_host";
import { encodeMemReadFrame } from "../../src/ioboard/debug_mem_read";
import { encodeMemWriteFrame } from "../../src/ioboard/debug_mem_write";
import { MEM_BYTES } from "../../src/shared/shared_board";
import { RESPONSE_CODE } from "../../src/shared/handshake/handshake_type";
import { startWorkerSlicePump } from "../cpuboard/monitor_hshk_call";

/** ユーザ RAM（ワード） */
const WORD_ADDR = 0x1800;

/** 同じ位置のバイトアドレス */
const BYTE_ADDR = WORD_ADDR * 2;

/**
 * IHX+CDB 組。無ければスキップ。
 * @returns パス組。無ければ null
 */
function loadMonitorOrSkip(): { hex: string; cdb: string } | null {
  try {
    return resolveBootMonitorHexCdbPair();
  } catch {
    return null;
  }
}

/**
 * CPU を進める。
 * @param steps 命令数
 */
function pumpCpu(steps = 64): void {
  for (let i = 0; i < steps; i++) tickCpu();
}

/**
 * H による halted まで待つ。
 * @param timeoutMs 上限
 */
async function waitHalted(timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  while (getExecStatus() !== "halted") {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(
        `timeout waiting HALT status=${getExecStatus()} IC=0x${(getState().IC & 0xffff).toString(16)}`,
      );
    }
    pumpCpu(256);
    await new Promise((r) => setTimeout(r, 0));
  }
}

/**
 * TCP で 1 フレーム送り、enough が真になるまで読む。
 * @param port 待ち受けポート
 * @param send 送信フレーム
 * @param enough 受信完了判定
 * @returns 受信バッファ
 */
function tcpSend(
  port: number,
  send: Uint8Array,
  enough: (buf: Buffer) => boolean,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port }, () => {
      sock.write(Buffer.from(send));
    });
    const chunks: Buffer[] = [];
    sock.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (enough(buf)) {
        sock.end();
        resolve(buf);
      }
    });
    sock.on("error", reject);
  });
}

/**
 * TCP 13h でメモリを読む。
 * @param port DebugHost ポート
 * @param byteAddr 開始バイトアドレス
 * @param byteCount バイト数
 * @returns データ
 */
async function tcpMemRead(
  port: number,
  byteAddr: number,
  byteCount: number,
): Promise<Uint8Array> {
  const frame = encodeMemReadFrame(byteAddr, byteCount);
  const body = await tcpSend(port, frame, (buf) => {
    if (buf.length >= 1 && buf[0] !== RESPONSE_CODE.OK) return true;
    return buf.length >= 5 && buf.length >= 5 + buf.readUInt32BE(1);
  });
  if (body[0] !== RESPONSE_CODE.OK) {
    throw new Error(`TCP 13h NG status=${body[0]}`);
  }
  const m = body.readUInt32BE(1);
  return Uint8Array.from(body.subarray(5, 5 + m));
}

/**
 * TCP 14h でメモリへ書く。
 * @param port DebugHost ポート
 * @param byteAddr 開始バイトアドレス
 * @param data 書き込むバイト列
 */
async function tcpMemWrite(
  port: number,
  byteAddr: number,
  data: Uint8Array,
): Promise<void> {
  const frame = encodeMemWriteFrame(byteAddr, data);
  const body = await tcpSend(port, frame, (buf) => buf.length >= 1);
  if (body[0] !== RESPONSE_CODE.OK) {
    throw new Error(`TCP 14h NG status=${body[0]}`);
  }
}

describe("デバッグ TCP メモリダンプ 13h/14h（HALT→IRQ2）", () => {
  let channel: MessageChannel;
  let client: BoardLinkClient;
  let agent: CpuHandshakeAgent;
  let host: DebugHost | null = null;
  let stopPump: (() => void) | null = null;

  beforeEach(() => {
    setMemory(new ArrayBuffer(MEM_BYTES));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    setResetVector(MONITOR_ENTRY_WORD);

    agent = new CpuHandshakeAgent({
      timeoutMs: 30_000,
      forward: () => Promise.resolve(new Uint8Array([0])),
    });
    attachHandshakeBus(agent.bus);
    attachIoBoardPorts();

    channel = new MessageChannel();
    attachCpuBoardLink(channel.port1, new CpuDmaTarget(5000), agent);
    agent.start();
    client = new BoardLinkClient();
    client.attach(channel.port2);
    stopPump = null;
  });

  afterEach(async () => {
    stopPump?.();
    stopPump = null;
    await host?.close();
    host = null;
    await agent.stop();
    channel.port1.close();
    channel.port2.close();
  });

  /**
   * モニタを HALT まで進め、IRQ2 スライスを回したまま DebugHost を開く。
   * @returns 待ち受けポート。IHX が無ければ null
   */
  async function bootAndListen(): Promise<number | null> {
    const pair = loadMonitorOrSkip();
    if (!pair) return null;
    const slice = readBootMonitorDmaSlice(pair.hex);
    await client.writeBytes(slice.byteAddr, slice.data);
    pulseCpuReset();
    stopPump = startWorkerSlicePump(agent.bus);
    await waitHalted();
    expect(getState().STR & STR_M2).toBe(STR_M2);

    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memRead: (byteAddr, byteCount) =>
          client.memReadBytes(byteAddr >>> 1, byteCount),
        memWrite: (byteAddr, data) =>
          client.memWriteBytes(byteAddr >>> 1, data),
      },
    });
    return host.listen();
  }

  it("13h は IRQ2 経由で CPU RAM を返す", async () => {
    const port = await bootAndListen();
    if (port === null) return;

    const view = new DataView(getMemory());
    view.setUint16(BYTE_ADDR, 0xabcd, false);

    const bytes = await tcpMemRead(port, BYTE_ADDR, 2);
    expect([...bytes]).toEqual([0xab, 0xcd]);
  }, 20_000);

  it("14h で書いて 13h で読める（IRQ2）", async () => {
    const port = await bootAndListen();
    if (port === null) return;

    await tcpMemWrite(port, BYTE_ADDR, new Uint8Array([0x12, 0x34]));
    const bytes = await tcpMemRead(port, BYTE_ADDR, 2);
    expect([...bytes]).toEqual([0x12, 0x34]);
    const view = new DataView(getMemory());
    expect(view.getUint16(BYTE_ADDR, false)).toBe(0x1234);
  }, 20_000);
});
