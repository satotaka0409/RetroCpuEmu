/**
 * IO LED ラッチ（ハンドシェイク 0x16）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyLedDisplayCommand,
  getLedDisplay,
  resetLedDisplay,
} from "../../../main/feature/board/io_led";

describe("io_led", () => {
  beforeEach(() => {
    resetLedDisplay();
  });

  it("初期状態は消灯", () => {
    const led = getLedDisplay();
    expect(led.sevenSeg.length).toBe(12);
    expect(led.sevenSeg.every((b: number) => b === 0)).toBe(true);
    expect(led.bulletLed0_7).toBe(0);
    expect(led.bulletLed8_F).toBe(0);
  });

  it("0x16 相当のデータをラッチする", () => {
    applyLedDisplayCommand({
      sevenSeg: new Uint8Array([
        0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c,
      ]),
      bulletLed0_7: 0x01,
      bulletLed8_F: 0x80,
    });
    const led = getLedDisplay();
    expect(led.sevenSeg[0]).toBe(0x3f);
    expect(led.sevenSeg[11]).toBe(0x7c);
    expect(led.bulletLed0_7).toBe(0x01);
    expect(led.bulletLed8_F).toBe(0x80);
  });
});
