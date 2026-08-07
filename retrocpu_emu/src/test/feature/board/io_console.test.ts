/**
 * IO コンソール（ファンクションキー）単体試験
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  IoConsole,
  type ConsoleCpuBridge,
} from "../../../main/feature/board/io_console";
import { getLedDisplay, resetLedDisplay } from "../../../main/feature/board/io_led";

function mockBridge(
  mem: Map<number, number> = new Map(),
): ConsoleCpuBridge & { mem: Map<number, number> } {
  let halted = true;
  return {
    mem,
    async memReadWord(wordAddr) {
      return mem.get(wordAddr >>> 0) ?? 0;
    },
    async memWriteWord(wordAddr, word) {
      mem.set(wordAddr >>> 0, word & 0xffff);
    },
    async exec() {
      halted = false;
    },
    async setHalt(h) {
      halted = h;
    },
    async pulseReset() {
      halted = true;
    },
    isHalted() {
      return halted;
    },
  };
}

describe("IoConsole", () => {
  beforeEach(() => {
    resetLedDisplay();
  });

  it("初期フォーカスは ADDR、ADS で DATA に切替", async () => {
    const c = new IoConsole(mockBridge());
    expect(c.getState().focus).toBe("addr");
    await c.onFunction("F0");
    expect(c.getState().focus).toBe("data");
    const led = getLedDisplay();
    expect((led.bulletLed8_F >> 7) & 1).toBe(1); // F = DATA
  });

  it("16進入力で ADDR を組み立てる", () => {
    const c = new IoConsole(mockBridge());
    c.onHex("1");
    c.onHex("8");
    c.onHex("0");
    c.onHex("0");
    expect(c.getState().wordAddr).toBe(0x1800);
  });

  it("RD はハンドシェイク相当の memRead で DATA を更新", async () => {
    const bridge = mockBridge(new Map([[0x100, 0xabcd]]));
    const c = new IoConsole(bridge);
    c.onHex("1");
    c.onHex("0");
    c.onHex("0");
    await c.onFunction("F1");
    expect(c.getState().dataWord).toBe(0xabcd);
    expect(c.getState().focus).toBe("data");
  });

  it("WINC は書いてから +1 して読む", async () => {
    const bridge = mockBridge(new Map([[0x11, 0x1111]]));
    const c = new IoConsole(bridge);
    // addr=0x10
    c.onHex("1");
    c.onHex("0");
    await c.onFunction("F0"); // data
    c.onHex("A");
    c.onHex("A");
    c.onHex("A");
    c.onHex("A");
    await c.onFunction("F4");
    expect(bridge.mem.get(0x10)).toBe(0xaaaa);
    expect(c.getState().wordAddr).toBe(0x11);
    expect(c.getState().dataWord).toBe(0x1111);
  });

  it("RUN / H/ST / RST が bridge を呼ぶ", async () => {
    const bridge = mockBridge();
    const exec = vi.spyOn(bridge, "exec");
    const setHalt = vi.spyOn(bridge, "setHalt");
    const pulseReset = vi.spyOn(bridge, "pulseReset");
    const c = new IoConsole(bridge);
    await c.onFunction("F5");
    expect(exec).toHaveBeenCalled();
    await c.onFunction("F6");
    expect(setHalt).toHaveBeenCalledWith(true);
    await c.onFunction("F7");
    expect(pulseReset).toHaveBeenCalled();
  });
});
