/**
 * 7セグ用ヘックス桁 → ビットパターン（a..g,dp = bit0..7）
 */

const HEX_TO_SEG: Record<string, number> = {
  "0": 0x3f,
  "1": 0x06,
  "2": 0x5b,
  "3": 0x4f,
  "4": 0x66,
  "5": 0x6d,
  "6": 0x7d,
  "7": 0x07,
  "8": 0x7f,
  "9": 0x6f,
  A: 0x77,
  B: 0x7c,
  C: 0x39,
  D: 0x5e,
  E: 0x79,
  F: 0x71,
};

/**
 * 16進 1 文字を 7セグのビットパターンへ変換する。
 * @param d "0"〜"9" / "A"〜"F"（小文字可）
 * @returns セグメントビット。未知の文字は 0（消灯）
 */
export function hexDigitToSeg(d: string): number {
  return HEX_TO_SEG[d.toUpperCase()] ?? 0;
}

/**
 * 数値を 16進表示して桁ごとの 7セグパターンにする。
 * @param value 表示する値
 * @param width 桁数。足りなければ 0 埋め、多ければ下位を採用
 * @returns 左の桁から並べたセグメントビット列
 */
export function wordToSegDigits(value: number, width: number): number[] {
  const hex = (value >>> 0)
    .toString(16)
    .toUpperCase()
    .padStart(width, "0")
    .slice(-width);
  return hex.split("").map(hexDigitToSeg);
}

/**
 * 設定桁数だけ点灯し、余った上位桁は消灯した 7セグ列を作る。
 * @param value 表示する値
 * @param usedDigits 点灯させる桁数（1〜totalDigits）
 * @param totalDigits フィールド全体の桁数（ADDR=8 / DATA=4）
 * @returns 左詰め消灯＋下位 usedDigits 桁
 */
export function wordToSegDigitsPadded(
  value: number,
  usedDigits: number,
  totalDigits: number,
): number[] {
  const total = Math.max(totalDigits, 1);
  const used = Math.min(Math.max(usedDigits, 1), total);
  const digits = wordToSegDigits(value, used);
  if (digits.length >= total) return digits.slice(-total);
  return [...Array(total - digits.length).fill(0), ...digits];
}
