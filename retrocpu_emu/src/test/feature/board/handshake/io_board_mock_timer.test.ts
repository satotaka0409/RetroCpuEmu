/**
 * IO ボードのタイマー割り込み（ハンドシェイク 19h）
 * 根拠: HandShake.mdc「タイマー設定」/ MN1613_CPUボードメモリ_IOマップ.mdc（INT_CAUSE）
 *
 * 19h でタイマーを開始・停止し、満了で INT_CAUSE=0（タイマー）の
 * レベル 2 割り込みが CPU 側に届くことを確認する。
 * ハンドシェイク自体が実時間の待ちを使うため、タイマーだけ手動スケジューラで進める。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RetroCpuHandshake } from "../../../../main/feature/cpu/mn1613/handhshake/handshake_retrocpu";
import { buildTimerSetFrame } from "../../../../main/feature/cpu/mn1613/handhshake/command_cpu_to_io";
import {
  INT_CAUSE_CODE,
  RESPONSE_CODE,
} from "../../../../main/feature/cpu/mn1613/handhshake/handshake_type";
import {
  createIoBoardHandshakeMock,
  IoBoardHandshakeMock,
} from "../../../../main/feature/board/handshake/io_board_mock";
import type {
  IoTimerHandle,
  IoTimerScheduler,
} from "../../../../main/feature/board/io_timer";
import {
  getPendingIrq,
  reset,
  setPins,
} from "../../../../main/feature/cpu/mn1613/mn1613";

/** IRQ2 のペンディングビット */
const IRQ2_BIT = 0x04;

/** タイマー割り込みが配送できないときの再試行間隔 (ms)。io_board_mock と同値 */
const RETRY_MS = 1;

type ManualScheduler = {
  scheduler: IoTimerScheduler;
  /** 予約中の待ち時間 (ms) 一覧（予約順） */
  pendingMs(): number[];
  /**
   * 指定した待ち時間の予約を 1 件だけ実行する。
   * @param ms 実行したい予約の待ち時間 (ms)
   * @throws 該当する予約が無い場合
   */
  fire(ms: number): void;
};

/**
 * 予約を保持して任意のタイミングで実行できる手動スケジューラを作る。
 * 実時間を進めずにタイマー満了・再試行を個別に起こすために使う。
 * @returns スケジューラ本体と、予約状態を操作するヘルパ
 */
function createManualScheduler(): ManualScheduler {
  let nextId = 1;
  const reservations = new Map<number, { cb: () => void; ms: number }>();
  const scheduler: IoTimerScheduler = {
    /**
     * 予約を登録する。
     * @param cb 満了時に呼ぶ処理
     * @param ms 待ち時間 (ms)
     * @returns 予約 ID をハンドルとして返す
     */
    setTimeout(cb, ms) {
      const id = nextId++;
      reservations.set(id, { cb, ms });
      return id as unknown as IoTimerHandle;
    },
    /**
     * 予約を破棄する。
     * @param handle setTimeout が返した予約 ID
     */
    clearTimeout(handle) {
      reservations.delete(handle as unknown as number);
    },
  };
  return {
    scheduler,
    pendingMs: () => [...reservations.values()].map((r) => r.ms),
    fire: (ms) => {
      for (const [id, r] of reservations) {
        if (r.ms !== ms) continue;
        reservations.delete(id);
        r.cb();
        return;
      }
      throw new Error(`no reservation for ${ms}ms`);
    },
  };
}

describe("IO ボードタイマー割り込み (19h)", () => {
  let mock: IoBoardHandshakeMock;
  let cpu: RetroCpuHandshake;
  let sched: ManualScheduler;

  beforeEach(() => {
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    reset();
    sched = createManualScheduler();
    // 応答送信（IO→CPU）でも HSHK_REQ_1 経由で IRQ2 が上がるため、
    // タイマー由来の割り込みだけを観測できるよう REQ_1 連動は切る。
    mock = createIoBoardHandshakeMock({
      timeoutMs: 1000,
      timerScheduler: sched.scheduler,
      syncIrq2: false,
    });
    cpu = new RetroCpuHandshake(mock.bus, 1000);
  });

  afterEach(async () => {
    await mock.stop();
    mock.detach();
  });

  /**
   * 19h（タイマー設定）を CPU→IO で送り、応答 1 バイトを受け取る。
   * @param timerNo タイマー番号（0 または 1）
   * @param periodMs 周期 (ms)。0 で停止
   * @param count 割り込み回数。0 で無限
   * @returns 応答コード
   */
  async function sendTimerSet(
    timerNo: number,
    periodMs: number,
    count: number,
  ): Promise<number> {
    const ioSide = mock.handleOneRequest();
    await cpu.send(buildTimerSetFrame({ timerNo, periodMs, count }));
    const [resp] = await Promise.all([cpu.receive(1), ioSide]);
    return resp[0]!;
  }

  it("初期化直後はタイマー割り込みが無い", () => {
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(false);
    expect(sched.pendingMs()).toEqual([]);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);
  });

  it("19h でタイマーが開始し、満了で INT_CAUSE=0 のレベル2割り込みが上がる", async () => {
    expect(await sendTimerSet(0, 20, 0)).toBe(RESPONSE_CODE.OK);
    expect(mock.timers[0].running).toBe(true);
    expect(sched.pendingMs()).toEqual([20]);
    expect(mock.state.lastTimer).toEqual({
      timerNo: 0,
      periodMs: 20,
      count: 0,
    });
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    sched.fire(20);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER0);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
    // 無限指定なので次の周期が再予約される
    expect(mock.timers[0].running).toBe(true);
    expect(sched.pendingMs()).toEqual([20]);
  });

  it("タイマー番号 1 は INT_CAUSE=1 で上がり、タイマー 0 とは独立に動く", async () => {
    await sendTimerSet(1, 30, 0);
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(true);

    sched.fire(30);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER1);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
  });

  it("19h の周期 0 で停止する", async () => {
    await sendTimerSet(0, 20, 0);
    expect(mock.timers[0].running).toBe(true);

    expect(await sendTimerSet(0, 0, 0)).toBe(RESPONSE_CODE.OK);
    expect(mock.timers[0].running).toBe(false);
    expect(sched.pendingMs()).toEqual([]);
  });

  it("回数を指定するとその回数で自動停止する", async () => {
    await sendTimerSet(0, 5, 2);
    sched.fire(5);
    expect(mock.timers[0].running).toBe(true);
    sched.fire(5);
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[0].getState().fired).toBe(2);
    expect(sched.pendingMs()).toEqual([]);
  });

  it("割り込み処理中 (INTERRUPT_BUSY=1) は配送を保留し、解除後に配送する", async () => {
    await sendTimerSet(0, 10, 0);
    mock.bus.INTERRUPT_BUSY = 1;

    sched.fire(10);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);
    // 次の周期の予約と、配送の再試行予約が並ぶ
    expect(sched.pendingMs()).toEqual([10, RETRY_MS]);

    sched.fire(RETRY_MS);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    mock.bus.INTERRUPT_BUSY = 0;
    sched.fire(RETRY_MS);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER0);
  });

  it("転送中 (HSHK_ENA=1) も配送を保留する", async () => {
    await sendTimerSet(0, 10, 0);
    mock.bus.HSHK_ENA = 1;

    sched.fire(10);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    mock.bus.HSHK_ENA = 0;
    sched.fire(RETRY_MS);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
  });

  it("2本同時に満了しても要因を混ぜず 1 件ずつ配送する", async () => {
    await sendTimerSet(0, 10, 1);
    await sendTimerSet(1, 10, 1);
    mock.bus.INTERRUPT_BUSY = 1;

    sched.fire(10); // タイマー0 満了（保留）
    sched.fire(10); // タイマー1 満了（保留）
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    mock.bus.INTERRUPT_BUSY = 0;
    sched.fire(RETRY_MS);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER0);
    // 残り 1 件のために再試行が予約されている
    expect(sched.pendingMs()).toEqual([RETRY_MS]);

    sched.fire(RETRY_MS);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER1);
    expect(sched.pendingMs()).toEqual([]);
  });

  it("detach でタイマーが止まる", async () => {
    await sendTimerSet(0, 10, 0);
    await sendTimerSet(1, 10, 0);
    expect(mock.timers[0].running).toBe(true);
    expect(mock.timers[1].running).toBe(true);
    mock.detach();
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(false);
    expect(sched.pendingMs()).toEqual([]);
  });
});
