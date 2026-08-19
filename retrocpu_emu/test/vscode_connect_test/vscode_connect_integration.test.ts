import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { MEM_BYTES } from "../../src/shared/shared_board";
import { RESPONSE_CODE } from "../../src/shared/handshake/handshake_type";
import {
  handshakeHandlerWordAddr,
  startHandshakeHandlerLoop,
} from "../cpuboard/monitor_hshk_call";
import { VS_DEBUG_STATUS, VsDebugClient } from "./vscode_debug_client";

const WORD_ADDR = 0x1800;
const BYTE_ADDR = WORD_ADDR * 2;

function loadMonitorOrSkip(): { hex: string; cdb: string } | null {
  try {
    return resolveBootMonitorHexCdbPair();
  } catch {
    return null;
  }
}

function pumpCpu(steps = 64): void {
  for (let i = 0; i < steps; i += 1) tickCpu();
}

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

describe("vscode_connect_test integration (mon.ihx)", () => {
  const monitorPair = loadMonitorOrSkip();
  const runIt = monitorPair ? it : it.skip;

  let channel: MessageChannel;
  let boardClient: BoardLinkClient;
  let hshkAgent: CpuHandshakeAgent;
  let host: DebugHost | null = null;
  let vsClient: VsDebugClient | null = null;
  let stopPump: (() => void) | null = null;
  let stopHandler: (() => void) | null = null;

  beforeEach(() => {
    setMemory(new ArrayBuffer(MEM_BYTES));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    setResetVector(MONITOR_ENTRY_WORD);

    hshkAgent = new CpuHandshakeAgent({
      timeoutMs: 30_000,
      wireIrq2: false,
      forward: () => Promise.resolve(new Uint8Array([0])),
    });
    attachHandshakeBus(hshkAgent.bus);
    attachIoBoardPorts();

    channel = new MessageChannel();
    attachCpuBoardLink(channel.port1, new CpuDmaTarget(5000), hshkAgent);
    hshkAgent.start();

    boardClient = new BoardLinkClient();
    boardClient.attach(channel.port2);
  });

  afterEach(async () => {
    vsClient?.close();
    vsClient = null;
    stopHandler?.();
    stopHandler = null;
    stopPump?.();
    stopPump = null;
    await host?.close();
    host = null;
    await hshkAgent.stop();
    channel.port1.close();
    channel.port2.close();
  });

  function startPump(): void {
    stopPump?.();
    let alive = true;
    const loop = (): void => {
      if (!alive) return;
      pumpCpu(256);
      setTimeout(loop, 0);
    };
    loop();
    stopPump = () => {
      alive = false;
    };
  }

  async function bootAndConnect(): Promise<void> {
    const pair = monitorPair;
    if (!pair) {
      throw new Error("boot monitor artifact is not available");
    }

    const slice = readBootMonitorDmaSlice(pair.hex);
    await boardClient.writeBytes(slice.byteAddr, slice.data);

    pulseCpuReset();
    startPump();
    await waitHalted();
    stopPump?.();
    stopPump = null;
    expect(getState().STR & STR_M2).toBe(STR_M2);

    stopHandler = startHandshakeHandlerLoop(
      hshkAgent.bus,
      handshakeHandlerWordAddr(pair.cdb),
    );

    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memRead: (byteAddr, byteCount) =>
          boardClient.memReadBytes(byteAddr >>> 1, byteCount),
        memWrite: (byteAddr, data) =>
          boardClient.memWriteBytes(byteAddr >>> 1, data),
      },
    });
    const port = await host.listen();
    vsClient = new VsDebugClient("127.0.0.1", port);
  }

  runIt(
    "83h は mon.ihx + CPU ハンドシェイク経由で RAM を読める",
    async () => {
      await bootAndConnect();

      const view = new DataView(getMemory());
      view.setUint16(BYTE_ADDR, 0xabcd, false);

      const data = await vsClient!.memRead(BYTE_ADDR, 2);
      expect([...data]).toEqual([0xab, 0xcd]);
    },
    20_000,
  );

  runIt(
    "84h で書いた値を 83h で読める",
    async () => {
      await bootAndConnect();

      const status = await vsClient!.memWrite(
        BYTE_ADDR,
        Uint8Array.from([0x12, 0x34]),
      );
      expect(status).toBe(VS_DEBUG_STATUS.OK);

      const data = await vsClient!.memRead(BYTE_ADDR, 2);
      expect([...data]).toEqual([0x12, 0x34]);

      const view = new DataView(getMemory());
      expect(view.getUint16(BYTE_ADDR, false)).toBe(0x1234);
    },
    20_000,
  );
});
