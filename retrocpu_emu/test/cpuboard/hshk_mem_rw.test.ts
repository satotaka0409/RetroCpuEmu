/**
 * 16進キー相当のメモリ R/W は DMA ではなくハンドシェイク 13h/14h。
 * 根拠: ioboard.mdc / HandShake.mdc / boot_monitor.mdc
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
  getState,
  powerOnIdle,
  setMemory,
  setPins,
  tickCpu,
  STR_M2,
} from "../../src/cpuboard/mn1613/mn1613";
import {
  readBootMonitorDmaSlice,
  resolveBootMonitorHexPath,
} from "../../src/ioboard/io_reset";
import { MEM_BYTES } from "../../src/shared/shared_board";

/** ユーザ RAM 先頭（ワード）。パネル RD の典型アドレス */
const WORD_ADDR = 0x1800;

/**
 * ブートモニタ IHX を RAM に載せ、RST して gl_main の H まで進める。
 * @returns IHX が無ければ null
 */
function loadMonitorOrSkip(): string | null {
  try {
    return resolveBootMonitorHexPath();
  } catch {
    return null;
  }
}

/**
 * CPU をスライス相当で進め、イベントループへ制御を返す。
 * @param steps 1 回あたりの命令数
 */
function pumpCpu(steps = 64): void {
  for (let i = 0; i < steps; i++) tickCpu();
}

/**
 * H 命令による halted になるまで tick する。
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

describe("16進キー相当: ハンドシェイク 13h/14h（DMA ではない）", () => {
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
      timeoutMs: 5000,
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
   * ハンドシェイク待ちの間も CPU を進める。
   */
  function startPump(): void {
    stopPump?.();
    const t = setInterval(() => pumpCpu(64), 1);
    stopPump = () => clearInterval(t);
  }

  it("RD 相当: 13h で 1 ワード読み、DMA read は使わない", async () => {
    const hexPath = loadMonitorOrSkip();
    if (!hexPath) return;

    const slice = readBootMonitorDmaSlice(hexPath);
    await client.writeBytes(slice.byteAddr, slice.data);
    pulseCpuReset();
    startPump();
    await waitHalted();
    expect(getState().STR & STR_M2).toBe(STR_M2);

    const view = new DataView(getMemory());
    view.setUint16(WORD_ADDR * 2, 0xabcd, false);

    const bytes = await client.memReadBytes(WORD_ADDR, 2);
    expect([...bytes]).toEqual([0xab, 0xcd]);
    expect(typeof (client as { readBytes?: unknown }).readBytes).toBe(
      "undefined",
    );
  }, 20_000);

  it("WINC 相当: 14h で 1 ワード書いて 13h で読める", async () => {
    const hexPath = loadMonitorOrSkip();
    if (!hexPath) return;

    const slice = readBootMonitorDmaSlice(hexPath);
    await client.writeBytes(slice.byteAddr, slice.data);
    pulseCpuReset();
    startPump();
    await waitHalted();
    expect(getState().STR & STR_M2).toBe(STR_M2);

    await client.memWriteBytes(WORD_ADDR, new Uint8Array([0x12, 0x34]));
    const bytes = await client.memReadBytes(WORD_ADDR, 2);
    expect([...bytes]).toEqual([0x12, 0x34]);
    const view = new DataView(getMemory());
    expect(view.getUint16(WORD_ADDR * 2, false)).toBe(0x1234);
  }, 20_000);
});
