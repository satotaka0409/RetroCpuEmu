/** 16進＋ファンクションキー（ioboard.mdc） */

const HEX_KEYS: string[][] = [
  ["C", "D", "E", "F"],
  ["8", "9", "A", "B"],
  ["4", "5", "6", "7"],
  ["0", "1", "2", "3"],
];

const FUNCTION_KEYS = ["F0", "F1", "F2", "F3", "F4", "F5", "F6", "F7"] as const;

export type HexKeyboardHandlers = {
  onHexClick?: (value: string) => void;
  onFunctionClick?: (fn: string) => void;
  /** F0→ADS など表示ラベル */
  functionLabels?: Record<string, string>;
};

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
    for (const fn of FUNCTION_KEYS.slice(row * 2, row * 2 + 2)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "function-key";
      const label = handlers.functionLabels?.[fn] ?? fn;
      btn.textContent = label;
      btn.title = `${fn} ${label}`;
      btn.addEventListener("click", () => handlers.onFunctionClick?.(fn));
      rowEl.appendChild(btn);
    }
    fns.appendChild(rowEl);
  }
  root.appendChild(fns);
}
