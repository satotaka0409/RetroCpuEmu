/**
 * CpuHandshakeAgent — CPU ボード側のハンドシェイク代行
 * 根拠: HandShake.mdc（CPU→IO 転送）
 *
 * CPU が線に流したコマンドがフレームとして組み立てられ、
 * IO ボード側のハンドラ（ここではタイマー）に届いて応答が返ることを確認する。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CpuHandshakeAgent } from "../../../main/feature/board/cpu_hshk_agent";
import { RetroCpuHandshake } from "../../../main/feature/cpu/mn1613/handhshake/handshake_retrocpu";
import {
  buildTimerSetFrame,
  CpuToIoCommandDispatcher,
} from "../../../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import { RESPONSE_CODE } from "../../../main/feature/cpu/mn1613/handhshake/handshake_type";
import {
  createDefaultCpuToIoHandlers,
  createIoBoardCommandState,
} from "../../../main/feature/board/handshake/io_board_mock";
import { IoTimer } from "../../../main/feature/board/io_timer";

describe("CpuHandshakeAgent", () => {
  let agent: CpuHandshakeAgent;
  let cpu: RetroCpuHandshake;
  let timers: readonly [IoTimer, IoTimer];
  let forwarded: number[];

  beforeEach(() => {
    forwarded = [];
    timers = [
      new IoTimer({ onExpire: () => {} }),
      new IoTimer({ onExpire: () => {} }),
    ];
    const dispatcher = new CpuToIoCommandDispatcher(
      createDefaultCpuToIoHandlers(createIoBoardCommandState(), timers),
    );
    agent = new CpuHandshakeAgent({
      timeoutMs: 1000,
      forward: (frame) => {
        forwarded.push(frame[0] ?? 0);
        return Promise.resolve(dispatcher.dispatch(frame));
      },
    });
    cpu = new RetroCpuHandshake(agent.bus, 1000);
    agent.start();
  });

  afterEach(async () => {
    await agent.stop();
    for (const t of timers) t.stop();
  });

  it("start / stop で受付ループが立ち上がり止まる", async () => {
    expect(agent.isServing).toBe(true);
    await agent.stop();
    expect(agent.isServing).toBe(false);
  });

  it("19h を線に流すと IO 側へ転送されタイマーが動き出す", async () => {
    expect(timers[0].running).toBe(false);

    await cpu.send(buildTimerSetFrame({ timerNo: 0, periodMs: 50, count: 3 }));
    const resp = await cpu.receive(1);

    expect(resp[0]).toBe(RESPONSE_CODE.OK);
    expect(forwarded).toEqual([0x19]);
    expect(timers[0].getState()).toMatchObject({
      running: true,
      periodMs: 50,
      count: 3,
    });
  });

  it("周期 0 の 19h で停止する", async () => {
    await cpu.send(buildTimerSetFrame({ timerNo: 1, periodMs: 50, count: 0 }));
    expect((await cpu.receive(1))[0]).toBe(RESPONSE_CODE.OK);
    expect(timers[1].running).toBe(true);

    await cpu.send(buildTimerSetFrame({ timerNo: 1, periodMs: 0, count: 0 }));
    expect((await cpu.receive(1))[0]).toBe(RESPONSE_CODE.OK);
    expect(timers[1].running).toBe(false);
  });

  it("連続して 2 件のコマンドを処理できる", async () => {
    await cpu.send(buildTimerSetFrame({ timerNo: 0, periodMs: 10, count: 0 }));
    await cpu.receive(1);
    await cpu.send(buildTimerSetFrame({ timerNo: 1, periodMs: 20, count: 0 }));
    await cpu.receive(1);

    expect(forwarded).toEqual([0x19, 0x19]);
    expect(timers[0].getState().periodMs).toBe(10);
    expect(timers[1].getState().periodMs).toBe(20);
  });
});
