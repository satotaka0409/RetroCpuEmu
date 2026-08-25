/**
 * io_undef_led.ts — 未定義命令 LED ラッチ（ハンドシェイク 13h）
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyUndefLedCommand,
  getUndefLed,
  resetUndefLed,
} from "../../../src/ioboard/bullet_led/io_undef_led";

describe("io_undef_led", () => {
  beforeEach(() => {
    resetUndefLed();
  });

  it("初期は消灯", () => {
    expect(getUndefLed()).toBe(false);
  });

  it("applyUndefLedCommand(true) で点灯し sticky", () => {
    applyUndefLedCommand(true);
    expect(getUndefLed()).toBe(true);
    applyUndefLedCommand(true);
    expect(getUndefLed()).toBe(true);
  });

  it("applyUndefLedCommand(false) で消灯", () => {
    applyUndefLedCommand(true);
    applyUndefLedCommand(false);
    expect(getUndefLed()).toBe(false);
  });

  it("resetUndefLed で消灯", () => {
    applyUndefLedCommand(true);
    resetUndefLed();
    expect(getUndefLed()).toBe(false);
  });
});
