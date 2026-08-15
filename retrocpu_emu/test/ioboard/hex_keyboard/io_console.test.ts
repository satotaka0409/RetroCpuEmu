/**
 * IO コンソール（ファンクションキー）単体試験
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  IoConsole,
  type ConsoleCpuBridge,
} from "../../../src/ioboard/hex_keyboard/io_console";
import {
  getLedDisplay,
  resetLedDisplay,
} from "../../../src/ioboard/seven_led/io_led";
import { resetUndefLed } from "../../../src/ioboard/bullet_led/io_undef_led";

/**
 * Map をメモリに見せる CPU ブリッジのモックを作る。
 * @param mem 初期メモリ内容（ワードアドレス → 値）
 * @returns ブリッジ実装と、検証用に参照できる同じ Map
 */
function mockBridge(
  mem: Map<number, number> = new Map(),
): ConsoleCpuBridge & { mem: Map<number, number> } {
  let halted = true;
  const setting = new Uint8Array(256);
  setting.fill(0xff);
  return {
    mem,
    async memReadWord(wordAddr) {
      return mem.get(wordAddr >>> 0) ?? 0;
    },
    async memWriteWord(wordAddr, word) {
      mem.set(wordAddr >>> 0, word & 0xffff);
    },
    async readSettingByte(byteAddr) {
      return setting[byteAddr & 0xff] ?? 0xff;
    },
    async writeSettingByte(byteAddr, value) {
      setting[byteAddr & 0xff] = value & 0xff;
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
    resetUndefLed();
  });

  it("初期フォーカスは ADDR、ADS で DATA に切替", async () => {
    const c = new IoConsole(mockBridge());
    expect(c.getState().focus).toBe("addr");
    expect(c.getState().mode).toBe("monitor");
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

  it("CLR は選択中が ADDR なら ADDR 表示のみ 0 クリアする", async () => {
    const c = new IoConsole(mockBridge());
    c.onHex("1");
    c.onHex("0");
    c.onHex("0");
    await c.onFunction("F1");
    expect(c.getState().wordAddr).toBe(0);
    expect(c.getState().focus).toBe("addr");
  });

  it("CLR は選択中が DATA なら DATA 表示のみ 0 クリアする", async () => {
    const c = new IoConsole(mockBridge());
    c.onHex("1");
    c.onHex("2");
    await c.onFunction("F0");
    c.onHex("A");
    c.onHex("B");
    c.onHex("C");
    c.onHex("D");
    await c.onFunction("F1");
    expect(c.getState().wordAddr).toBe(0x12);
    expect(c.getState().dataWord).toBe(0);
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

  it("RUN / H/ST / RST が bridge を呼び、RST はパネルを初期化する", async () => {
    const bridge = mockBridge();
    const exec = vi.spyOn(bridge, "exec");
    const setHalt = vi.spyOn(bridge, "setHalt");
    const pulseReset = vi.spyOn(bridge, "pulseReset");
    const c = new IoConsole(bridge);
    expect((getLedDisplay().bulletLed8_F >> 5) & 1).toBe(1); // D=HALT
    await c.onFunction("F5");
    expect(exec).toHaveBeenCalled();
    expect((getLedDisplay().bulletLed8_F >> 4) & 1).toBe(1); // C=RUN
    await c.onFunction("F6");
    expect(setHalt).toHaveBeenCalledWith(true);
    expect((getLedDisplay().bulletLed8_F >> 5) & 1).toBe(1);
    await c.onFunction("F7");
    expect(pulseReset).toHaveBeenCalled();
    expect(c.getState().halted).toBe(true);
    expect(c.getState().undefInsn).toBe(false);
    expect(c.getState().focus).toBe("addr");
    expect(c.getState().wordAddr).toBe(0);
    expect(c.getState().dataWord).toBe(0);
    expect((getLedDisplay().bulletLed8_F >> 5) & 1).toBe(1); // D=HALT
  });

  it("notifyCpuReset は UNDEF を消し ADDR フォーカス・HALT 表示に戻す", () => {
    const c = new IoConsole(mockBridge());
    c.onHex("1");
    c.onHex("8");
    c.setUndefLed(true);
    expect(c.getState().undefInsn).toBe(true);
    c.notifyCpuReset();
    expect(c.getState().undefInsn).toBe(false);
    expect(c.getState().halted).toBe(true);
    expect(c.getState().focus).toBe("addr");
    expect(c.getState().mode).toBe("monitor");
    expect(c.getState().wordAddr).toBe(0);
    expect(c.getState().dataWord).toBe(0);
    expect((getLedDisplay().bulletLed8_F >> 3) & 1).toBe(0);
    expect((getLedDisplay().bulletLed8_F >> 5) & 1).toBe(1); // D=HALT
    expect((getLedDisplay().bulletLed8_F >> 6) & 1).toBe(1); // E=ADDR
  });

  it("H/ST はパネル状態でトグル（isHalted が常に true でも HALT できる）", async () => {
    const bridge = mockBridge();
    bridge.isHalted = () => true;
    const setHalt = vi.spyOn(bridge, "setHalt");
    const c = new IoConsole(bridge);
    await c.onFunction("F6");
    expect(setHalt).toHaveBeenLastCalledWith(false);
    expect(c.getState().halted).toBe(false);
    await c.onFunction("F6");
    expect(setHalt).toHaveBeenLastCalledWith(true);
    expect(c.getState().halted).toBe(true);
  });

  it("setUndefLed(13h) で砲弾 B を点灯/消灯できる", () => {
    const c = new IoConsole(mockBridge());
    c.setUndefLed(true);
    expect(c.getState().undefInsn).toBe(true);
    expect(c.getState().halted).toBe(true);
    expect((getLedDisplay().bulletLed8_F >> 3) & 1).toBe(1);
    c.setUndefLed(false);
    expect(c.getState().undefInsn).toBe(false);
    expect((getLedDisplay().bulletLed8_F >> 3) & 1).toBe(0);
  });

  it("ADS 長押しで設定エリア編集モードへ入り、再長押しで戻る", () => {
    const c = new IoConsole(mockBridge());
    c.onHex("1");
    c.onHex("2");
    c.onAdsLongPress();
    expect(c.getState().mode).toBe("setting_area");
    expect(c.getState().focus).toBe("addr");
    expect(c.getState().wordAddr).toBe(0);
    expect(c.getState().dataWord).toBe(0);
    c.onAdsLongPress();
    expect(c.getState().mode).toBe("monitor");
  });

  it("設定エリア編集モードではアドレス/データ入力を 2 桁に丸める", async () => {
    const c = new IoConsole(mockBridge());
    c.onAdsLongPress();
    c.onHex("1");
    c.onHex("2");
    c.onHex("3");
    expect(c.getState().wordAddr).toBe(0x23);
    await c.onFunction("F0");
    c.onHex("A");
    c.onHex("B");
    c.onHex("C");
    expect(c.getState().dataWord).toBe(0xbc);
  });

  it("設定エリア編集モードの WINC は設定エリアへ 1 バイト書いて +1 先を読む", async () => {
    const bridge = mockBridge();
    const writeSettingByte = vi.spyOn(bridge, "writeSettingByte");
    const readSettingByte = vi.spyOn(bridge, "readSettingByte");
    await bridge.writeSettingByte(0x11, 0x3a);

    const c = new IoConsole(bridge);
    c.onAdsLongPress();
    c.onHex("1");
    c.onHex("0");
    await c.onFunction("F0");
    c.onHex("A");
    c.onHex("5");

    await c.onFunction("F4");

    expect(writeSettingByte).toHaveBeenCalledWith(0x10, 0xa5);
    expect(readSettingByte).toHaveBeenCalledWith(0x11);
    expect(c.getState().wordAddr).toBe(0x11);
    expect(c.getState().dataWord).toBe(0x3a);
    expect(c.getState().focus).toBe("data");
  });

  it("アドレス増加数 2 なら INC は +2 し、奇数入力は先に -1 する", async () => {
    const bridge = mockBridge(
      new Map([
        [0x10, 0x1010],
        [0x12, 0x1212],
      ]),
    );
    await bridge.writeSettingByte(0x05, 2);

    const c = new IoConsole(bridge);
    c.onHex("1");
    c.onHex("1");
    await c.onFunction("F2");
    expect(c.getState().wordAddr).toBe(0x12);
    expect(c.getState().dataWord).toBe(0x1212);
  });
});
