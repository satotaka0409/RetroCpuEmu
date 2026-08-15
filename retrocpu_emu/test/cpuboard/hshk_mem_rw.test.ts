/**
 * 16進キー相当のメモリ R/W は DMA ではなくハンドシェイク 13h/14h。
 * 根拠: ioboard.mdc / HandShake.mdc / boot_monitor.mdc
 *
 * CPU 側は BIOS 結合テストと同じく、HALT 後に REQ_1 を待って
 * `g_handshake_interrupt_handler` を `run()` する（IRQ2 は使わない）。
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
  resolveBootMonitorHexCdbPair,
} from "../../src/ioboard/io_reset";
import { MEM_BYTES } from "../../src/shared/shared_board";
import {
  handshakeHandlerWordAddr,
  withHandshakeHandler,
} from "./monitor_hshk_call";

/** ユーザ RAM 先頭（ワード）。パネル RD の典型アドレス */
const WORD_ADDR = 0x1800;

/**
 * ブートモニタ IHX を RAM に載せ、RST して gl_main の H まで進める。
 * @returns IHX が無ければ null
 */
function loadMonitorOrSkip(): { hex: string; cdb: string } | null {
  try {
    return resolveBootMonitorHexCdbPair();
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
  let handlerWord: number | null = null;

  beforeEach(() => {
    setMemory(new ArrayBuffer(MEM_BYTES));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    setResetVector(MONITOR_ENTRY_WORD);

    agent = new CpuHandshakeAgent({
      timeoutMs: 30_000,
      wireIrq2: false,
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
    handlerWord = null;
  });

  afterEach(async () => {
    stopPump?.();
    stopPump = null;
    await agent.stop();
    channel.port1.close();
    channel.port2.close();
  });

  /**
   * ブートの HALT 待ち用に CPU を進める。
   */
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

  /**
   * モニタを DMA して HALT まで進める。
   * @returns IHX が無ければ false
   */
  async function bootMonitor(): Promise<boolean> {
    const pair = loadMonitorOrSkip();
    if (!pair) return false;
    const slice = readBootMonitorDmaSlice(pair.hex);
    await client.writeBytes(slice.byteAddr, slice.data);
    pulseCpuReset();
    startPump();
    await waitHalted();
    stopPump?.();
    stopPump = null;
    handlerWord = handshakeHandlerWordAddr(pair.cdb);
    return true;
  }

  /**
   * 13h を BIOS と同じ手順で実行する。
   * @param wordAddr 開始ワードアドレス
   * @param byteCount バイト数
   * @returns 読み出したバイト
   */
  function memReadViaBios(
    wordAddr: number,
    byteCount: number,
  ): Promise<Uint8Array> {
    if (handlerWord === null) {
      throw new Error("bootMonitor していない");
    }
    return withHandshakeHandler(agent.bus, handlerWord, () =>
      client.memReadBytes(wordAddr, byteCount),
    );
  }

  /**
   * 14h を BIOS と同じ手順で実行する。
   * @param wordAddr 開始ワードアドレス
   * @param data 書き込むバイト列
   */
  function memWriteViaBios(wordAddr: number, data: Uint8Array): Promise<void> {
    if (handlerWord === null) {
      throw new Error("bootMonitor していない");
    }
    return withHandshakeHandler(agent.bus, handlerWord, () =>
      client.memWriteBytes(wordAddr, data),
    );
  }

  it("RD 相当: 13h で 1 ワード読み、DMA read は使わない", async () => {
    if (!(await bootMonitor())) return;
    expect(getState().STR & STR_M2).toBe(STR_M2);

    const view = new DataView(getMemory());
    view.setUint16(WORD_ADDR * 2, 0xabcd, false);

    const bytes = await memReadViaBios(WORD_ADDR, 2);
    expect([...bytes]).toEqual([0xab, 0xcd]);
    expect(typeof (client as { readBytes?: unknown }).readBytes).toBe(
      "undefined",
    );
  }, 20_000);

  it("13h はワード 8000h（byte_hi LSB=1）を読む", async () => {
    if (!(await bootMonitor())) return;

    const word = 0x8000;
    const view = new DataView(getMemory());
    view.setUint16(word * 2, 0xa5a5, false);

    const bytes = await memReadViaBios(word, 2);
    expect([...bytes]).toEqual([0xa5, 0xa5]);
  }, 20_000);

  it("WINC 相当: 14h で 1 ワード書いて 13h で読める", async () => {
    if (!(await bootMonitor())) return;
    expect(getState().STR & STR_M2).toBe(STR_M2);

    await memWriteViaBios(WORD_ADDR, new Uint8Array([0x12, 0x34]));
    const bytes = await memReadViaBios(WORD_ADDR, 2);
    expect([...bytes]).toEqual([0x12, 0x34]);
    const view = new DataView(getMemory());
    expect(view.getUint16(WORD_ADDR * 2, false)).toBe(0x1234);
  }, 20_000);

  it("13h は 257 バイトを返す", async () => {
    if (!(await bootMonitor())) return;

    const n = 257;
    const expected = fillPattern(WORD_ADDR * 2, n);
    const bytes = await memReadViaBios(WORD_ADDR, n);
    expect([...bytes]).toEqual([...expected]);
  }, 60_000);

  it("13h はダンプ窓 0x1220 バイトを返す", async () => {
    if (!(await bootMonitor())) return;

    const n = DUMP_WINDOW_BYTES;
    const expected = fillPattern(WORD_ADDR * 2, n);
    const bytes = await memReadViaBios(WORD_ADDR, n);
    expect(bytes.length).toBe(n);
    expect([...bytes]).toEqual([...expected]);
  }, 120_000);
});

/** デバッグダンプ窓 ±800h ワードのバイト数 */
const DUMP_WINDOW_BYTES = 0x1220;

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
