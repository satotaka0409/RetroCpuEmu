/**
 * LCD1602 エミュレータ（19h/1Ah）
 * 根拠: HandShake.mdc「LCD制御」「LCD文字列表示」
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  LCD_COLS,
  LCD_RESPONSE,
  LcdConsoleEmulator,
  emptyLcdWire,
  getLcdWire,
  lcdConsole,
  resetLcdConsole,
} from "../../../src/ioboard/lcd_console";

describe("LcdConsoleEmulator", () => {
  let lcd: LcdConsoleEmulator;

  beforeEach(() => {
    lcd = new LcdConsoleEmulator();
  });

  it("初期状態は 16x2 空白・表示ON", () => {
    const snap = lcd.snapshot();
    expect(snap.cols).toBe(LCD_COLS);
    expect(snap.rows).toBe(2);
    expect(snap.lines[0]).toBe(" ".repeat(16));
    expect(snap.lines[1]).toBe(" ".repeat(16));
    expect(snap.displayOn).toBe(true);
    expect(snap.cursorOn).toBe(false);
  });

  it("1Ah で指定位置に文字列を書き、行末で打ち切る", () => {
    const frame = new Uint8Array(20);
    frame[0] = 0x1a;
    frame[1] = 0;
    frame[2] = 12;
    frame[3] = 8;
    const text = "HELLO!!!";
    for (let i = 0; i < text.length; i++) frame[4 + i] = text.charCodeAt(i);
    expect(lcd.handleTextFrame(frame)).toBe(LCD_RESPONSE.OK);
    expect(lcd.snapshot().lines[0].slice(12)).toBe("HELL");
    expect(lcd.snapshot().cursorCol).toBe(15);
  });

  it("19h Clear で全消去しカーソルをホームへ戻す", () => {
    lcd.writeText(1, 0, "ABC");
    const frame = new Uint8Array([0x19, 0, 0, 0, 0]);
    expect(lcd.handleControlFrame(frame)).toBe(LCD_RESPONSE.OK);
    const snap = lcd.snapshot();
    expect(snap.lines[1]).toBe(" ".repeat(16));
    expect(snap.cursorRow).toBe(0);
    expect(snap.cursorCol).toBe(0);
  });

  it("19h SetCursor の行不正は NG", () => {
    const frame = new Uint8Array([0x19, 3, 0, 2, 0]);
    expect(lcd.handleControlFrame(frame)).toBe(LCD_RESPONSE.NG);
  });

  it("DisplayCtrl で表示OFF/カーソル/点滅を切り替える", () => {
    const frame = new Uint8Array([0x19, 2, 0b110, 0, 0]);
    expect(lcd.handleControlFrame(frame)).toBe(LCD_RESPONSE.OK);
    const snap = lcd.snapshot();
    expect(snap.displayOn).toBe(false);
    expect(snap.cursorOn).toBe(true);
    expect(snap.blinkOn).toBe(true);
  });
});

describe("共有 LCD インスタンス", () => {
  beforeEach(() => {
    resetLcdConsole();
  });

  it("reset 後は emptyLcdWire と同じ空白表示", () => {
    lcdConsole.writeText(0, 0, "X");
    resetLcdConsole();
    expect(getLcdWire()).toEqual(emptyLcdWire());
  });
});
