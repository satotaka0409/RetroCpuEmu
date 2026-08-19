/** 16進＋ファンクションキー（HandShake.mdc 14h キー配置） */

import { HEX_KEY_COL_BIT3_TO_0 } from "../ioboard/hex_keyboard/key_matrix";

/** 画面上段→下段。列 0–3 の Bit3–0（C 8 4 0 …） */
const HEX_KEYS: string[][] = [0, 1, 2, 3].map((fromTop) =>
  [0, 1, 2, 3].map((col) => HEX_KEY_COL_BIT3_TO_0[col]![fromTop]!),
);

export type HexKeyboardHandlers = {
  onHexClick?: (value: string) => void;
  /** 16進キーを押し始めた（14h 押し続け） */
  onHexDown?: (value: string) => void;
  /** 16進キーを離した */
  onHexUp?: (value: string) => void;
  onFunctionClick?: (fn: string) => void;
  /** ファンクションキーを押し始めた（14h 押し続け） */
  onFunctionDown?: (fn: string) => void;
  /** ファンクションキーを離した */
  onFunctionUp?: (fn: string) => void;
  onFunctionLongPress?: (fn: string) => void;
  /** F0→ADS など表示ラベル */
  functionLabels?: Record<string, string>;
};

const LONG_PRESS_MS = 700;

/**
 * ポインタが本当に離れたか（WSLg では押し続け中に pointercancel が来ることがある）。
 * @param ev ポインタイベント
 * @returns 主ボタンが上がっていれば true
 */
function isPointerReleased(ev: PointerEvent): boolean {
  return (ev.buttons & 1) === 0;
}

/**
 * 16進 16 キーとファンクション 8 キーを描画する（既存の子要素は差し替える）。
 * @param root 描画先要素
 * @param handlers クリック時のコールバックと F キーの表示ラベル
 */
export function mountHexKeyboard(
  root: HTMLElement,
  handlers: HexKeyboardHandlers = {},
): void {
  root.replaceChildren();
  root.className = "hex-keyboard-root";

  const hex = document.createElement("div");
  hex.className = "hex-keyboard";
  for (const row of HEX_KEYS) {
    const rowEl = document.createElement("div");
    rowEl.className = "hex-key-row";
    for (const key of row) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hex-key";
      btn.textContent = key;
      btn.addEventListener("pointerdown", (ev) => {
        btn.setPointerCapture(ev.pointerId);
        handlers.onHexDown?.(key);
      });
      btn.addEventListener("pointerup", (ev) => {
        if (isPointerReleased(ev)) handlers.onHexUp?.(key);
      });
      btn.addEventListener("pointercancel", (ev) => {
        if (isPointerReleased(ev)) handlers.onHexUp?.(key);
      });
      btn.addEventListener("click", () => handlers.onHexClick?.(key));
      rowEl.appendChild(btn);
    }
    hex.appendChild(rowEl);
  }
  root.appendChild(hex);

  const fns = document.createElement("div");
  fns.className = "function-keys function-keys-grid";
  for (let row = 0; row < 4; row++) {
    const rowEl = document.createElement("div");
    rowEl.className = "function-key-row";
    const rowFns = [
      HEX_KEY_COL_BIT3_TO_0[4]![row]!,
      HEX_KEY_COL_BIT3_TO_0[5]![row]!,
    ];
    for (const fn of rowFns) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "function-key";
      const label = handlers.functionLabels?.[fn] ?? fn;
      btn.textContent = label;
      btn.title = `${fn} ${label}`;
      let longTimer: ReturnType<typeof setTimeout> | null = null;
      let longPressed = false;

      const clearLongTimer = (): void => {
        if (longTimer !== null) {
          clearTimeout(longTimer);
          longTimer = null;
        }
      };

      btn.addEventListener("pointerdown", (ev) => {
        btn.setPointerCapture(ev.pointerId);
        handlers.onFunctionDown?.(fn);
        longPressed = false;
        clearLongTimer();
        longTimer = setTimeout(() => {
          longTimer = null;
          longPressed = true;
          handlers.onFunctionLongPress?.(fn);
        }, LONG_PRESS_MS);
      });
      btn.addEventListener("pointerup", (ev) => {
        clearLongTimer();
        if (isPointerReleased(ev)) handlers.onFunctionUp?.(fn);
      });
      btn.addEventListener("pointercancel", (ev) => {
        clearLongTimer();
        if (isPointerReleased(ev)) handlers.onFunctionUp?.(fn);
      });
      btn.addEventListener("click", () => handlers.onFunctionClick?.(fn));
      btn.addEventListener(
        "click",
        (ev) => {
          if (!longPressed) return;
          longPressed = false;
          ev.preventDefault();
          ev.stopImmediatePropagation();
        },
        { capture: true },
      );
      rowEl.appendChild(btn);
    }
    fns.appendChild(rowEl);
  }
  root.appendChild(fns);
}
