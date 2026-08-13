/**
 * IO ボードタイマー（ハンドシェイク 15h の実体）単体試験
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IoTimer } from "../../../src/ioboard/timer/io_timer";
import { RESPONSE_CODE } from "../../../src/shared/handshake/handshake_type";

describe("IoTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("初期状態は停止（割り込み無し）", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    expect(timer.running).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("周期を設定すると周期ごとに満了する（回数 0 = 無限）", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    expect(timer.configure({ periodMs: 10, count: 0 })).toBe(RESPONSE_CODE.OK);
    expect(timer.running).toBe(true);

    vi.advanceTimersByTime(9);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30);
    expect(onExpire).toHaveBeenCalledTimes(4);
    expect(timer.running).toBe(true);
  });

  it("回数を指定するとその回数で自動停止する", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    timer.configure({ periodMs: 5, count: 3 });

    vi.advanceTimersByTime(5);
    expect(timer.getState().remaining).toBe(2);
    vi.advanceTimersByTime(10);
    expect(onExpire).toHaveBeenCalledTimes(3);
    expect(timer.running).toBe(false);

    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledTimes(3);
    expect(timer.getState().fired).toBe(3);
  });

  it("周期 0 を設定すると停止する（15h の停止指定）", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    timer.configure({ periodMs: 10, count: 0 });
    vi.advanceTimersByTime(20);
    expect(onExpire).toHaveBeenCalledTimes(2);

    expect(timer.configure({ periodMs: 0, count: 0 })).toBe(RESPONSE_CODE.OK);
    expect(timer.running).toBe(false);
    vi.advanceTimersByTime(100);
    expect(onExpire).toHaveBeenCalledTimes(2);
  });

  it("stop() でも停止し、設定値がクリアされる", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    timer.configure({ periodMs: 10, count: 5 });
    timer.stop();
    expect(timer.getState()).toMatchObject({
      running: false,
      periodMs: 0,
      count: 0,
      remaining: 0,
    });
    vi.advanceTimersByTime(100);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("稼働中の再設定は新しい周期・回数で開始し直す", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    timer.configure({ periodMs: 100, count: 0 });
    vi.advanceTimersByTime(50);
    timer.configure({ periodMs: 10, count: 2 });

    // 前の予約（残り 50ms）は破棄されている
    vi.advanceTimersByTime(10);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(onExpire).toHaveBeenCalledTimes(2);
    expect(timer.running).toBe(false);
  });

  it("周期は minPeriodMs で下限を切る", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire, minPeriodMs: 4 });
    timer.configure({ periodMs: 1, count: 0 });
    vi.advanceTimersByTime(3);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("16bit を超える値・非整数は NG を返し停止のまま", () => {
    const onExpire = vi.fn();
    const timer = new IoTimer({ onExpire });
    expect(timer.configure({ periodMs: 0x10000, count: 0 })).toBe(
      RESPONSE_CODE.NG_OTHER_ERROR,
    );
    expect(timer.configure({ periodMs: 10, count: -1 })).toBe(
      RESPONSE_CODE.NG_OTHER_ERROR,
    );
    expect(timer.configure({ periodMs: 1.5, count: 0 })).toBe(
      RESPONSE_CODE.NG_OTHER_ERROR,
    );
    expect(timer.running).toBe(false);
  });

  it("scheduler を差し替えて手動で満了させられる", () => {
    const onExpire = vi.fn();
    let pending: { cb: () => void; ms: number } | null = null;
    const timer = new IoTimer({
      onExpire,
      scheduler: {
        /**
         * 予約を 1 件だけ保持する（多重予約は上書き）。
         * @param cb 満了時に呼ぶ処理
         * @param ms 待ち時間 (ms)
         * @returns ダミーハンドル
         */
        setTimeout(cb, ms) {
          pending = { cb, ms };
          return 1 as unknown as ReturnType<typeof setTimeout>;
        },
        /** 予約を破棄する */
        clearTimeout() {
          pending = null;
        },
      },
    });

    timer.configure({ periodMs: 250, count: 0 });
    expect(pending).not.toBeNull();
    expect(pending!.ms).toBe(250);
    pending!.cb();
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(pending!.ms).toBe(250);
  });
});
