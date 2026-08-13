/**
 * LCD1602 風の 16x2 キャラクタ表示（ioboard.mdc）
 */

import type { LcdStateWire } from "../shared/emu_api";

/** LCD1602 の列数 */
const LCD_COLS = 16;
/** LCD1602 の行数 */
const LCD_ROWS = 2;

const SPACE = " ";

export type Lcd1602View = {
  /** スナップショットを画面へ反映する */
  render(state: LcdStateWire | undefined): void;
};

/**
 * LCD1602 モジュールを描画する。
 * @param root 挿入先（既存の子は差し替える）
 * @returns 更新用ビュー
 */
export function mountLcd1602(root: HTMLElement): Lcd1602View {
  root.replaceChildren();
  root.classList.add("lcd1602-root");

  const module = document.createElement("div");
  module.className = "lcd1602-module";

  const bezel = document.createElement("div");
  bezel.className = "lcd1602-bezel";

  const screen = document.createElement("div");
  screen.className = "lcd1602-screen";
  screen.setAttribute("aria-label", "LCD1602");

  const cells: HTMLSpanElement[] = [];
  for (let row = 0; row < LCD_ROWS; row++) {
    const line = document.createElement("div");
    line.className = "lcd1602-line";
    for (let col = 0; col < LCD_COLS; col++) {
      const cell = document.createElement("span");
      cell.className = "lcd1602-cell";
      cell.textContent = SPACE;
      line.appendChild(cell);
      cells.push(cell);
    }
    screen.appendChild(line);
  }

  bezel.appendChild(screen);
  module.appendChild(bezel);
  root.appendChild(module);

  return {
    /**
     * LCD 状態をセルへ反映する。
     * @param state Worker からの LCD スナップショット。未指定なら空白
     */
    render(state: LcdStateWire | undefined): void {
      const displayOn = state?.displayOn !== false;
      const cursorOn = state?.cursorOn === true;
      const blinkOn = state?.blinkOn === true;
      const cursorRow = state?.cursorRow ?? 0;
      const cursorCol = state?.cursorCol ?? 0;
      for (let row = 0; row < LCD_ROWS; row++) {
        const text = padLine(displayOn ? (state?.lines[row] ?? "") : "");
        for (let col = 0; col < LCD_COLS; col++) {
          const cell = cells[row * LCD_COLS + col]!;
          cell.textContent = text[col] ?? SPACE;
          const isCursor =
            displayOn && cursorOn && row === cursorRow && col === cursorCol;
          cell.classList.toggle("lcd-cursor", isCursor);
          cell.classList.toggle("lcd-cursor-blink", isCursor && blinkOn);
        }
      }
    },
  };
}

/**
 * 1 行を 16 文字に揃える（足りなければ空白、多ければ切り詰め）。
 * @param line 元の行
 * @returns 16 文字
 */
function padLine(line: string): string {
  const raw = line.length >= LCD_COLS ? line.slice(0, LCD_COLS) : line;
  return raw.padEnd(LCD_COLS, SPACE);
}
