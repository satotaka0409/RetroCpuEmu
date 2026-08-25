/**
 * TMS9995 パネル相当: ハンドシェイク 13h/14h のバイトアドレス変換。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MessageChannel } from "node:worker_threads";
import {
  attachCpuBoardLink,
  setBoardLinkCpuType,
} from "../../../src/cpuboard/cpu_board_link";
import { BoardLinkClient } from "../../../src/ioboard/board_link_client";
import { CpuHandshakeAgent } from "../../../src/cpuboard/cpu_hshk_agent";
import { CpuDmaTarget } from "../../../src/cpuboard/cpu_dma";
import { pulseCpuReset } from "../../../src/cpuboard/boot";
import {
  attachHandshakeBus,
  attachIoBoardPorts,
  setCpuPortMode,
  CPU_PORT_MODE,
} from "../../../src/cpuboard/io_ports";
import { CPU_TYPE } from "../../../src/ioboard/setting_area";
import {
  getExecStatus,
  getMemory,
  powerOnIdle,
  setMemory,
  setPins,
  tickCpu,
} from "../../../src/cpuboard/tms9995/tms9995";
import { TMS_MEM_BYTES } from "../../../src/cpuboard/tms9995/types";
import { MEM_BYTES } from "../../../src/shared/shared_board";
import {
  readBootMonitorDmaSlice,
  resolveBootMonitorHexCdbPair,
} from "../../../src/ioboard/io_reset";
import { parseTms9995Cdb } from "../../../retrocpu_test_framework/src/tms9995/cdb";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** TMS9995 モニタ IHX/CDB を解決する。無ければ null */
function loadTms9995MonitorOrSkip(): { hex: string; cdb: string } | null {
  try {
    const pair = resolveBootMonitorHexCdbPair();
    if (!pair.hex.toLowerCase().includes("tms9995")) return null;
    return pair;
  } catch {
    return null;
  }
}

/** ハンドラ入口バイトアドレス */
function handshakeHandlerByteAddr(cdbPath: string): number {
  const table = parseTms9995Cdb(fs.readFileSync(cdbPath, "utf8"));
  const key = "G_HANDSHAKE_INTERRUPT_HANDLER";
  const sym =
    table.byName.get(key) ??
    table.byName.get(key.toLowerCase()) ??
    [...table.byName.values()].find((s) => s.name.toUpperCase() === key);
  if (!sym) throw new Error(`CDB symbol not found: ${key}`);
  return sym.byteAddr;
}

async function waitHalted(timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  while (getExecStatus() !== "halted") {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timeout HALT status=${getExecStatus()}`);
    }
    for (let i = 0; i < 256; i += 1) tickCpu();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe("TMS9995 ハンドシェイク 13h/14h（バイトアドレス）", () => {
  let channel: MessageChannel;
  let client: BoardLinkClient;
  let agent: CpuHandshakeAgent;
  let stopPump: (() => void) | null = null;

  beforeEach(() => {
    setMemory(new ArrayBuffer(Math.max(TMS_MEM_BYTES, MEM_BYTES)));
    setPins({ HLT: false, RST: false, IRQ1: false, IRQ2: false, NMI: false });
    powerOnIdle();
    setCpuPortMode(CPU_PORT_MODE.TMS9995);
    setBoardLinkCpuType(CPU_TYPE.TMS9995);

    agent = new CpuHandshakeAgent({
      cpuType: CPU_TYPE.TMS9995,
      timeoutMs: 30_000,
      forward: () => Promise.resolve(new Uint8Array([0])),
    });
    attachHandshakeBus(agent.bus);
    attachIoBoardPorts();

    channel = new MessageChannel();
    attachCpuBoardLink(channel.port1, new CpuDmaTarget(CPU_TYPE.TMS9995), agent);
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

  function startPump(): void {
    stopPump?.();
    let alive = true;
    const loop = (): void => {
      if (!alive) return;
      for (let i = 0; i < 256; i += 1) tickCpu();
      setTimeout(loop, 0);
    };
    loop();
    stopPump = () => {
      alive = false;
    };
  }

  it("13h でバイトアドレス 0100h を読める（wordAddr×2 しない）", async () => {
    const pair = loadTms9995MonitorOrSkip();
    if (!pair) return;

    const slice = readBootMonitorDmaSlice(pair.hex);
    await client.writeBytes(slice.byteAddr, slice.data);
    pulseCpuReset(CPU_TYPE.TMS9995);
    startPump();
    await waitHalted();
    stopPump?.();
    stopPump = null;

    const mem = getMemory();
    mem[0x0100] = 0xab;
    mem[0x0101] = 0xcd;

    const bytes = await client.memReadBytes(0x0100, 2);
    expect([...bytes]).toEqual([0xab, 0xcd]);
  }, 30_000);

  it("CDB に g_handshake_interrupt_handler がある", () => {
    const pair = loadTms9995MonitorOrSkip();
    if (!pair) return;
    expect(handshakeHandlerByteAddr(pair.cdb)).toBeGreaterThan(0);
  });
});
