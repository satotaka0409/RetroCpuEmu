/**
 * 製品経路: HALT 中の HSHK_IN_REQ → IRQ2 → INT2 ハンドラで 13h/14h。
 * CPU Worker と同じスライス（handshakeBusy なら 1024 命令＋ yield）。
 * 根拠: ioboard.mdc / HandShake.mdc / cpu_slice.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  getPendingIrq,
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
import { MEM_BYTES } from "../../src/shared/shared_board";
import { startWorkerSlicePump } from "./monitor_hshk_call";

/** ユーザ RAM 先頭（ワード） */
const WORD_ADDR = 0x1800;

/** デバッグダンプ窓 ±800h ワードのバイト数 */
const DUMP_WINDOW_BYTES = 0x1220;

/** IRQ2 ペンディングビット */
const IRQ2_BIT = 0x04;

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
 * CPU を進めてイベントループへ戻す。
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
 * 物理メモリにパターンを書く。
 * @param byteAddr 開始バイトアドレス
 * @param n バイト数
 * @returns 書いた列
 */
function fillPattern(byteAddr: number, n: number): Uint8Array {
  const view = new DataView(getMemory());
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const b = (i * 13 + 7) & 0xff;
    out[i] = b;
    view.setUint8(byteAddr + i, b);
  }
  return out;
}

describe("製品経路 HALT→IRQ2: ハンドシェイク 13h/14h", () => {
  let channel: MessageChannel;
  let client: BoardLinkClient;
  let agent: CpuHandshakeAgent;
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
    await agent.stop();
    channel.port1.close();
    channel.port2.close();
  });

  /**
   * モニタを DMA して HALT まで進め、Worker 相当のスライスを回し続ける。
   * @returns IHX が無ければ false
   */
  async function bootMonitor(): Promise<boolean> {
    const pair = loadMonitorOrSkip();
    if (!pair) return false;
    const slice = readBootMonitorDmaSlice(pair.hex);
    await client.writeBytes(slice.byteAddr, slice.data);
    pulseCpuReset();
    stopPump = startWorkerSlicePump(agent.bus);
    await waitHalted();
    expect(getState().STR & STR_M2).toBe(STR_M2);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);
    return true;
  }

  it("RD 相当: HALT から IRQ2 で 13h が 1 ワードを返す", async () => {
    if (!(await bootMonitor())) return;

    const view = new DataView(getMemory());
    view.setUint16(WORD_ADDR * 2, 0xabcd, false);

    const bytes = await client.memReadBytes(WORD_ADDR, 2);
    expect([...bytes]).toEqual([0xab, 0xcd]);
    await waitHalted();
  }, 20_000);

  it("WINC 相当: IRQ2 で 14h のあと 13h で読める", async () => {
    if (!(await bootMonitor())) return;

    await client.memWriteBytes(WORD_ADDR, new Uint8Array([0x12, 0x34]));
    const bytes = await client.memReadBytes(WORD_ADDR, 2);
    expect([...bytes]).toEqual([0x12, 0x34]);
    const view = new DataView(getMemory());
    expect(view.getUint16(WORD_ADDR * 2, false)).toBe(0x1234);
    await waitHalted();
  }, 20_000);

  it("13h は IRQ2 経路で 257 バイトを返す", async () => {
    if (!(await bootMonitor())) return;

    const n = 257;
    const expected = fillPattern(WORD_ADDR * 2, n);
    const bytes = await client.memReadBytes(WORD_ADDR, n);
    expect([...bytes]).toEqual([...expected]);
  }, 60_000);

  it("13h は IRQ2 経路でダンプ窓 0x1220 バイトを返す", async () => {
    if (!(await bootMonitor())) return;

    const n = DUMP_WINDOW_BYTES;
    const expected = fillPattern(WORD_ADDR * 2, n);
    const bytes = await client.memReadBytes(WORD_ADDR, n);
    expect(bytes.length).toBe(n);
    expect([...bytes]).toEqual([...expected]);
  }, 120_000);
});
