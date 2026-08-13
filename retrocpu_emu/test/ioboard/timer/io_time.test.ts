/**
 * IO ボード 64bit 時刻タイマー（ハンドシェイク 16h）単体試験
 */

import { describe, it, expect } from "vitest";
import {
  IoTimeCounter,
  IO_TIME_TICK_NS,
} from "../../../src/ioboard/timer/io_time";

describe("IoTimeCounter", () => {
  it("生成直後は 0 で、reset するまで進まない", () => {
    let now = 0n;
    const clock = new IoTimeCounter({ nowNs: () => now });
    expect(clock.running).toBe(false);
    expect(clock.ticks()).toBe(0n);
    now = 100_000n;
    expect(clock.ticks()).toBe(0n);
    expect([...clock.readTimestamp()]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("reset 直後は 0、だいたい 10µs ごとに +1", () => {
    let now = 1_000n;
    const clock = new IoTimeCounter({ nowNs: () => now });
    clock.reset();
    expect(clock.running).toBe(true);
    expect(clock.ticks()).toBe(0n);

    now = 1_000n + IO_TIME_TICK_NS - 1n;
    expect(clock.ticks()).toBe(0n);
    now = 1_000n + IO_TIME_TICK_NS;
    expect(clock.ticks()).toBe(1n);
    now = 1_000n + 25_000n;
    expect(clock.ticks()).toBe(2n);
    now = 1_000n + 100_000n;
    expect(clock.ticks()).toBe(10n);
  });

  it("readTimestamp は上位バイト先頭（時刻7…0）", () => {
    let now = 0n;
    const clock = new IoTimeCounter({ nowNs: () => now });
    clock.reset();
    now = 0x0123_4567_89ab_cdefn * IO_TIME_TICK_NS;
    expect([...clock.readTimestamp()]).toEqual([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    ]);
  });

  it("reset し直すと 0 から数え直す", () => {
    let now = 0n;
    const clock = new IoTimeCounter({ nowNs: () => now });
    clock.reset();
    now = 50_000n;
    expect(clock.ticks()).toBe(5n);
    clock.reset();
    expect(clock.ticks()).toBe(0n);
    now = 60_000n;
    expect(clock.ticks()).toBe(1n);
  });

  it("stop 後はティックが凍る", () => {
    let now = 0n;
    const clock = new IoTimeCounter({ nowNs: () => now });
    clock.reset();
    now = 30_000n;
    clock.stop();
    expect(clock.running).toBe(false);
    expect(clock.ticks()).toBe(3n);
    now = 1_000_000n;
    expect(clock.ticks()).toBe(3n);
    expect([...clock.readTimestamp()]).toEqual([0, 0, 0, 0, 0, 0, 0, 3]);
  });
});
