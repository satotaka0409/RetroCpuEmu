/**
 * ハンドシェイク中の CPU スライス計画
 */

import { describe, it, expect } from "vitest";
import {
  HSHK_STEPS_PER_SLICE,
  cpuSlicePlan,
  handshakeBusyFromBus,
} from "../../src/cpuboard/cpu_slice";

describe("cpuSlicePlan", () => {
  it("通常は指定の steps / sliceMs", () => {
    expect(cpuSlicePlan(false, 32, 4)).toEqual({ steps: 32, delayMs: 4 });
  });

  it("ハンドシェイク中は delay 0 と大きいバースト", () => {
    expect(cpuSlicePlan(true, 32, 4)).toEqual({
      steps: HSHK_STEPS_PER_SLICE,
      delayMs: 0,
    });
  });
});

describe("handshakeBusyFromBus", () => {
  const idle = {
    HSHK_OUT_REQ: 0,
    HSHK_OUT_DENA: 0,
    HSHK_IN_DACK: 0,
    HSHK_IN_REQ: 0,
    HSHK_IN_DENA: 0,
    HSHK_OUT_DACK: 0,
    INTERRUPT_BUSY: 0,
  };

  it("全て 0 なら忙しくない", () => {
    expect(handshakeBusyFromBus(idle)).toBe(false);
  });

  it("REQ/DENA/DACK/INTERRUPT_BUSY のいずれかで忙しい", () => {
    expect(handshakeBusyFromBus({ ...idle, HSHK_OUT_REQ: 1 })).toBe(true);
    expect(handshakeBusyFromBus({ ...idle, HSHK_OUT_DENA: 1 })).toBe(true);
    expect(handshakeBusyFromBus({ ...idle, HSHK_IN_DACK: 1 })).toBe(true);
    expect(handshakeBusyFromBus({ ...idle, HSHK_IN_REQ: 1 })).toBe(true);
    expect(handshakeBusyFromBus({ ...idle, HSHK_IN_DENA: 1 })).toBe(true);
    expect(handshakeBusyFromBus({ ...idle, HSHK_OUT_DACK: 1 })).toBe(true);
    expect(handshakeBusyFromBus({ ...idle, INTERRUPT_BUSY: 1 })).toBe(true);
  });
});
