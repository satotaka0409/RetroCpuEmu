/**
 * IO ボードのタイマー割り込み配送
 * 根拠: HandShake.mdc「タイマー設定」/ MN1613_CPUボードメモリ_IOマップ.mdc（INT_CAUSE）
 *
 * 15h の受理はアセンブラ（handshake_timer）側。ここでは IoTimer.configure
 * 後の満了 → INT_CAUSE / IRQ2 / INTERRUPT_BUSY 保留を確認する。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { INT_CAUSE_CODE } from "../../../src/shared/handshake/handshake_type";
import {
  createIoBoardHandshakeMock,
  IoBoardHandshakeMock,
} from "../../../src/ioboard/handshake/io_board_mock";
import type {
  IoTimerHandle,
  IoTimerScheduler,
} from "../../../src/ioboard/timer/io_timer";
import {
  getPendingIrq,
  reset,
  setPins,
} from "../../../src/cpuboard/mn1613/mn1613";

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

describe("IO ボードタイマー割り込み", () => {
  let mock: IoBoardHandshakeMock;
  let sched: ManualScheduler;

  beforeEach(() => {
    setPins({ HLT: false, RST: false, IRQ0: false, IRQ1: false, IRQ2: false });
    reset();
    sched = createManualScheduler();
    mock = createIoBoardHandshakeMock({
      timeoutMs: 1000,
      timerScheduler: sched.scheduler,
      syncIrq2: false,
    });
  });

  afterEach(async () => {
    await mock.stop();
    mock.detach();
  });

  /**
   * タイマー番号 0/1 を設定する（15h ハンドラ相当。線上の送受信はしない）。
   * @param timerNo タイマー番号（0 または 1）
   * @param periodMs 周期 (ms)。0 で停止
   * @param count 割り込み回数。0 で無限
   */
  function configureTimer(
    timerNo: number,
    periodMs: number,
    count: number,
  ): void {
    mock.timers[timerNo]!.configure({ periodMs, count });
  }

  it("初期化直後はタイマー割り込みが無い", () => {
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(false);
    expect(sched.pendingMs()).toEqual([]);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);
  });

  it("タイマー開始後、満了で INT_CAUSE=0 のレベル2割り込みが上がる", () => {
    configureTimer(0, 20, 0);
    expect(mock.timers[0].running).toBe(true);
    expect(sched.pendingMs()).toEqual([20]);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    sched.fire(20);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER0);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
    expect(mock.timers[0].running).toBe(true);
    expect(sched.pendingMs()).toEqual([20]);
  });

  it("タイマー番号 1 は INT_CAUSE=1 で上がり、タイマー 0 とは独立に動く", () => {
    configureTimer(1, 30, 0);
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(true);

    sched.fire(30);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER1);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
  });

  it("周期 0 で停止する", () => {
    configureTimer(0, 20, 0);
    expect(mock.timers[0].running).toBe(true);

    configureTimer(0, 0, 0);
    expect(mock.timers[0].running).toBe(false);
    expect(sched.pendingMs()).toEqual([]);
  });

  it("回数を指定するとその回数で自動停止する", () => {
    configureTimer(0, 5, 2);
    sched.fire(5);
    expect(mock.timers[0].running).toBe(true);
    sched.fire(5);
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[0].getState().fired).toBe(2);
    expect(sched.pendingMs()).toEqual([]);
  });

  it("割り込み処理中 (INTERRUPT_BUSY=1) は配送を保留し、解除後に配送する", () => {
    configureTimer(0, 10, 0);
    mock.bus.INTERRUPT_BUSY = 1;

    sched.fire(10);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);
    expect(sched.pendingMs()).toEqual([10, RETRY_MS]);

    sched.fire(RETRY_MS);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    mock.bus.INTERRUPT_BUSY = 0;
    sched.fire(RETRY_MS);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER0);
  });

  it("転送中 (HSHK_ENA=1) も配送を保留する", () => {
    configureTimer(0, 10, 0);
    mock.bus.HSHK_ENA = 1;

    sched.fire(10);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    mock.bus.HSHK_ENA = 0;
    sched.fire(RETRY_MS);
    expect(getPendingIrq() & IRQ2_BIT).toBe(IRQ2_BIT);
  });

  it("2本同時に満了しても要因を混ぜず 1 件ずつ配送する", () => {
    configureTimer(0, 10, 1);
    configureTimer(1, 10, 1);
    mock.bus.INTERRUPT_BUSY = 1;

    sched.fire(10);
    sched.fire(10);
    expect(getPendingIrq() & IRQ2_BIT).toBe(0);

    mock.bus.INTERRUPT_BUSY = 0;
    sched.fire(RETRY_MS);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER0);
    expect(sched.pendingMs()).toEqual([RETRY_MS]);

    sched.fire(RETRY_MS);
    expect(mock.bus.INT_CAUSE).toBe(INT_CAUSE_CODE.TIMER1);
    expect(sched.pendingMs()).toEqual([]);
  });

  it("detach でタイマーが止まる", () => {
    configureTimer(0, 10, 0);
    configureTimer(1, 10, 0);
    expect(mock.timers[0].running).toBe(true);
    expect(mock.timers[1].running).toBe(true);
    mock.detach();
    expect(mock.timers[0].running).toBe(false);
    expect(mock.timers[1].running).toBe(false);
    expect(sched.pendingMs()).toEqual([]);
  });
});
