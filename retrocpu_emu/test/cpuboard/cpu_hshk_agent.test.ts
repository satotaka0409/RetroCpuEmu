/**
 * CpuHandshakeAgent — CPU Worker 上の IO 側橋（REQ_0 受付ループ）
 * 根拠: HandShake.mdc（CPU→IO 転送）
 *
 * 線上の CPU 側はアセンブラ。ここでは受付ループの start / stop のみ確認する。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CpuHandshakeAgent } from "../../src/cpuboard/cpu_hshk_agent";

describe("CpuHandshakeAgent", () => {
  let agent: CpuHandshakeAgent;

  beforeEach(() => {
    agent = new CpuHandshakeAgent({
      timeoutMs: 1000,
      forward: () => Promise.resolve(new Uint8Array([0])),
    });
    agent.start();
  });

  afterEach(async () => {
    await agent.stop();
  });

  it("start / stop で受付ループが立ち上がり止まる", async () => {
    expect(agent.isServing).toBe(true);
    await agent.stop();
    expect(agent.isServing).toBe(false);
  });
});
