import { describe, expect, it } from "vitest";
import { resolveBeepAction } from "../../src/shared/beep";

describe("resolveBeepAction", () => {
  it("周波数 0 は停止", () => {
    expect(resolveBeepAction({ frequencyHz: 0, durationMs: 1000 })).toEqual({
      type: "stop",
    });
  });

  it("長さ 0 は無限再生", () => {
    expect(resolveBeepAction({ frequencyHz: 440, durationMs: 0 })).toEqual({
      type: "play",
      frequencyHz: 440,
      stopAfterMs: null,
    });
  });

  it("長さありはミリ秒後に止める", () => {
    expect(resolveBeepAction({ frequencyHz: 880, durationMs: 1000 })).toEqual({
      type: "play",
      frequencyHz: 880,
      stopAfterMs: 1000,
    });
  });
});
