/**
 * ボードリンク（IO ボード Worker ↔ CPU ボード Worker）の
 * 割り込み要求と CPU→IO コマンドフレーム転送
 * 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc（IO:0021 INT_CAUSE）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MessageChannel } from "node:worker_threads";
import {
  attachCpuBoardLink,
  sendCpuToIoFrame,
} from "../../src/cpuboard/cpu_board_link";
import { BoardLinkClient } from "../../src/ioboard/board_link_client";
import type { BoardLinkResponse } from "../../src/shared/board_link";
import { CpuDmaTarget } from "../../src/cpuboard/cpu_dma";
import {
  attachHandshakeBus,
  attachIoBoardPorts,
} from "../../src/cpuboard/io_ports";
import { INT_CAUSE_CODE } from "../../src/shared/handshake/handshake_type";
import {
  getMemory,
  getPendingIrq,
  getState,
  powerOnIdle,
  setMemory,
  setPins,
  setState,
  startRun,
  step,
} from "../../src/cpuboard/mn1613/mn1613";

/** IRQ2 のペンディングビット */
const IRQ2_BIT = 0x04;

/** `rd R0, 0x21`（INT_CAUSE を R0 に読む）の機械語 */
const INSN_RD_R0_INT_CAUSE = 0x1821;

/**
 * CPU に `rd R0, 0x21` を 1 命令だけ実行させ、読めた割り込み要因を返す。
 * @returns R0 に読み込まれた INT_CAUSE の値
 */
function readIntCauseFromCpu(): number {
  new DataView(getMemory()).setUint16(0, INSN_RD_R0_INT_CAUSE, false);
  setState({ IC: 0 });
  startRun();
  step();
  return getState().R[0]!;
}

describe("ボードリンク: IO→CPU 割り込み要求 / CPU→IO フレーム転送", () => {
  let channel: MessageChannel;
  let client: BoardLinkClient;

  beforeEach(() => {
    setMemory(new ArrayBuffer(0x1000));
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    powerOnIdle();
    // ハンドシェイクバス未接続（IO ポートの内部ラッチ経路）を確認する
    attachHandshakeBus(null);
    attachIoBoardPorts();

    channel = new MessageChannel();
    attachCpuBoardLink(channel.port1, new CpuDmaTarget(200));
    client = new BoardLinkClient();
    client.attach(channel.port2);
  });

  afterEach(() => {
    channel.port1.close();
    channel.port2.close();
  });

  it("初期状態では割り込みが上がっていない", () => {
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);
  });

  it("タイマー0の割り込み要求で INT_CAUSE=0 とレベル2割り込みが立つ", async () => {
    await client.raiseInterrupt(2, INT_CAUSE_CODE.TIMER0);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
    expect(readIntCauseFromCpu()).toBe(INT_CAUSE_CODE.TIMER0);
  });

  it("タイマー1の割り込み要求では INT_CAUSE=1 が読める", async () => {
    await client.raiseInterrupt(2, INT_CAUSE_CODE.TIMER1);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
    expect(readIntCauseFromCpu()).toBe(INT_CAUSE_CODE.TIMER1);
  });

  it("CPU→IO フレームを転送して IO 側の応答が返る", async () => {
    const received: Uint8Array[] = [];
    client.setCpuToIoFrameHandler((frame) => {
      received.push(frame.slice());
      return new Uint8Array([0x00]);
    });

    const frame = new Uint8Array([0x12, 0x01, 0x00, 0x0a, 0x00, 0x02]);
    const response = await sendCpuToIoFrame(frame);

    expect([...response]).toEqual([0x00]);
    expect(received).toHaveLength(1);
    expect([...received[0]!]).toEqual([...frame]);
  });

  it("IO 側にハンドラ未登録ならエラーになる", async () => {
    client.setCpuToIoFrameHandler(null);
    await expect(sendCpuToIoFrame(new Uint8Array([0x12]))).rejects.toThrow(
      /handler not set/,
    );
  });

  it("DMA は書き込み専用で dma:readBytes を拒否する", async () => {
    const reply = new Promise<BoardLinkResponse>((resolve) => {
      const onMsg = (msg: BoardLinkResponse) => {
        if (msg?.type === "link:result" && msg.id === 9001) {
          channel.port2.off("message", onMsg);
          resolve(msg);
        }
      };
      channel.port2.on("message", onMsg);
    });
    channel.port2.postMessage({
      type: "dma:readBytes",
      id: 9001,
      byteAddr: 0,
      byteCount: 2,
    });
    const msg = await reply;
    expect(msg.ok).toBe(false);
    expect(msg.error).toMatch(/write-only/i);
  });

  it("DMA writeBytes は書け、読み API は無い", async () => {
    await client.writeBytes(0x20, new Uint8Array([0xab, 0xcd]));
    const view = new DataView(getMemory());
    expect(view.getUint8(0x20)).toBe(0xab);
    expect(view.getUint8(0x21)).toBe(0xcd);
    expect(typeof (client as { readBytes?: unknown }).readBytes).toBe(
      "undefined",
    );
  });

  it("エージェント無しの hshk 13h は拒否する（DMA では読まない）", async () => {
    await expect(client.memReadBytes(0x10, 2)).rejects.toThrow(
      /handshake agent/i,
    );
  });
});
