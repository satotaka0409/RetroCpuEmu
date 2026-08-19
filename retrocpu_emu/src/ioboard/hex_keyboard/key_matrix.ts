/**
 * ハンドシェイク 14h のキー行列。
 * 根拠: HandShake.mdc「16進キー入力取得」キー配置（Bit3–0、OFF=0 ON=1）。
 * 列 6–7 は未定義（常に 0）。
 */

/** 列 0–5 の Bit3→Bit0（表の左が Bit3＝画面上段） */
export const HEX_KEY_COL_BIT3_TO_0: readonly (readonly string[])[] = [
  ["C", "8", "4", "0"],
  ["D", "9", "5", "1"],
  ["E", "A", "6", "2"],
  ["F", "B", "7", "3"],
  ["F0", "F2", "F4", "F6"],
  ["F1", "F3", "F5", "F7"],
] as const;

export type PanelKeyLoc = {
  /** 列番号 0–5 */
  col: number;
  /** その列のビットマスク（Bit3–0） */
  mask: number;
};

/**
 * パネルキー名を 14h の列とビットマスクへ写す。
 * @param key "0"–"F" または "F0"–"F7"（大文字小文字無視）
 * @returns 列とマスク。未知の名前は null
 */
export function panelKeyColumnMask(key: string): PanelKeyLoc | null {
  const k = key.trim().toUpperCase();
  for (let col = 0; col < HEX_KEY_COL_BIT3_TO_0.length; col++) {
    const names = HEX_KEY_COL_BIT3_TO_0[col]!;
    const i = names.indexOf(k);
    if (i < 0) continue;
    return { col, mask: 1 << (3 - i) };
  }
  return null;
}
