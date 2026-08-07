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
} from "../../../main/feature/board/cpu_board_link";
import { BoardLinkClient } from "../../../main/feature/board/board_link_client";
import { CpuDmaTarget } from "../../../main/feature/board/cpu_dma";
import {
  attachHandshakeBus,
  attachIoBoardPorts,
} from "../../../main/feature/board/io_ports";
import { INT_CAUSE_CODE } from "../../../main/feature/cpu/mn1613/handhshake/handshake_type";
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
} from "../../../main/feature/cpu/mn1613/mn1613";

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

    const frame = new Uint8Array([0x19, 0x01, 0x00, 0x0a, 0x00, 0x02]);
    const response = await sendCpuToIoFrame(frame);

    expect([...response]).toEqual([0x00]);
    expect(received).toHaveLength(1);
    expect([...received[0]!]).toEqual([...frame]);
  });

  it("IO 側にハンドラ未登録ならエラーになる", async () => {
    client.setCpuToIoFrameHandler(null);
    await expect(sendCpuToIoFrame(new Uint8Array([0x19]))).rejects.toThrow(
      /handler not set/,
    );
  });
});
