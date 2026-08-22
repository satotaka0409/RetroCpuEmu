/**
 * TMS9995 ステータスフラグ更新。
 * 根拠: TMS9995_instruction.mdc（ST bit0=MSB）
 */

import { ST_AGT, ST_C, ST_EQ, ST_IMASK, ST_LGT, ST_OP, ST_OV } from "./types";

/**
 * ワード結果で L>/A>/EQ を立てる（比較以外の算術・論理）。
 * @param st 現在の ST
 * @param result 16bit 結果
 * @returns 更新後 ST（C/OV/OP は維持）
 */
export function setLaeWord(st: number, result: number): number {
  const r = result & 0xffff;
  let out = st & ~(ST_LGT | ST_AGT | ST_EQ);
  if (r === 0) out |= ST_EQ;
  else {
    out |= ST_LGT;
    if ((r & 0x8000) === 0) out |= ST_AGT;
  }
  return out;
}

/**
 * バイト結果（左寄せ or 下位）で L>/A>/EQ/OP を立てる。
 * @param st 現在の ST
 * @param resultByte 8bit
 * @returns 更新後 ST
 */
export function setLaeByte(st: number, resultByte: number): number {
  const b = resultByte & 0xff;
  let out = st & ~(ST_LGT | ST_AGT | ST_EQ | ST_OP);
  if (b === 0) out |= ST_EQ;
  else {
    out |= ST_LGT;
    if ((b & 0x80) === 0) out |= ST_AGT;
  }
  let ones = 0;
  for (let i = 0; i < 8; i += 1) if ((b >> i) & 1) ones += 1;
  if (ones & 1) out |= ST_OP;
  return out;
}

/**
 * 比較（dest − src）相当のフラグ。値は書き換えない。
 * @param st 現在の ST
 * @param dest 16bit
 * @param src 16bit
 * @returns 更新後 ST
 */
export function setCompareWord(st: number, dest: number, src: number): number {
  const d = dest & 0xffff;
  const s = src & 0xffff;
  let out = st & ~(ST_LGT | ST_AGT | ST_EQ);
  if (d === s) out |= ST_EQ;
  if (d > s) out |= ST_LGT;
  const ds = (d << 16) >> 16;
  const ss = (s << 16) >> 16;
  if (ds > ss) out |= ST_AGT;
  return out;
}

/**
 * バイト比較フラグ。
 * @param st 現在の ST
 * @param destByte 8bit
 * @param srcByte 8bit
 * @returns 更新後 ST
 */
export function setCompareByte(
  st: number,
  destByte: number,
  srcByte: number,
): number {
  const d = destByte & 0xff;
  const s = srcByte & 0xff;
  let out = st & ~(ST_LGT | ST_AGT | ST_EQ | ST_OP);
  if (d === s) out |= ST_EQ;
  if (d > s) out |= ST_LGT;
  const ds = (d << 24) >> 24;
  const ss = (s << 24) >> 24;
  if (ds > ss) out |= ST_AGT;
  let ones = 0;
  for (let i = 0; i < 8; i += 1) if ((d >> i) & 1) ones += 1;
  if (ones & 1) out |= ST_OP;
  return out;
}

/**
 * 加算のキャリー／オーバーフローを載せる。
 * @param st ST
 * @param a 加算前 dest
 * @param b source
 * @param result a+b
 * @returns ST
 */
export function setAddFlags(
  st: number,
  a: number,
  b: number,
  result: number,
): number {
  const aa = a & 0xffff;
  const bb = b & 0xffff;
  const sum = aa + bb;
  let out = setLaeWord(st, result);
  out = sum > 0xffff ? out | ST_C : out & ~ST_C;
  const as = (aa << 16) >> 16;
  const bs = (bb << 16) >> 16;
  const rs = (result << 16) >> 16;
  const ov = (as > 0 && bs > 0 && rs < 0) || (as < 0 && bs < 0 && rs >= 0);
  out = ov ? out | ST_OV : out & ~ST_OV;
  return out;
}

/**
 * 減算（dest−src）のフラグ。
 * @param st ST
 * @param a dest
 * @param b src
 * @param result a−b
 * @returns ST
 */
export function setSubFlags(
  st: number,
  a: number,
  b: number,
  result: number,
): number {
  const aa = a & 0xffff;
  const bb = b & 0xffff;
  let out = setLaeWord(st, result);
  // 9900: borrow なし → C=1
  out = aa >= bb ? out | ST_C : out & ~ST_C;
  const as = (aa << 16) >> 16;
  const bs = (bb << 16) >> 16;
  const rs = (result << 16) >> 16;
  const ov =
    (as >= 0 && bs < 0 && rs < 0) || (as < 0 && bs >= 0 && rs >= 0);
  out = ov ? out | ST_OV : out & ~ST_OV;
  return out;
}

/**
 * 割り込みマスク（ST 下位 4bit）を返す。
 * @param st ST
 * @returns 0..15
 */
export function interruptMask(st: number): number {
  return st & ST_IMASK;
}
