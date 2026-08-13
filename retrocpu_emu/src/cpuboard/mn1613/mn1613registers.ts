/**
 * MN1613 CPU レジスタ状態
 * 根拠: mn1613_register.png / MN1613.mdc
 *
 * 格納型:
 * - 16-bit: Uint16Array(1)（値は [0]）
 * - 24-bit (SP/STR): Uint16Array(2)（[0]=上位8bit, [1]=下位16bit）
 * - 下位4bit 有効 (CSBR/SSBR/TSR/OSR/SBRB): Uint8Array(1)（値は [0] & 0xf）
 * - IISR（下位1bit 有効）: boolean
 */

/** 8/16-bit レジスタ値を Uint16Array(1) にする */
export function reg16(v: number): Uint16Array {
  return Uint16Array.of(v & 0xffff);
}

/** 24-bit レジスタ値を Uint16Array(2) にする */
export function reg24(v: number): Uint16Array {
  return Uint16Array.of((v >>> 16) & 0xff, v & 0xffff);
}

/**
 * 下位4bit 有効なセグメント系レジスタを Uint8Array(1) にする。
 * @param v 値（上位は捨てる）
 */
export function reg4(v: number): Uint8Array {
  return Uint8Array.of(v & 0xf);
}

/** Uint16Array(1) → 数値 */
export function fromReg16(a: Uint16Array): number {
  return (a[0] ?? 0) & 0xffff;
}

/** Uint16Array(2) → 24-bit 数値 */
export function fromReg24(a: Uint16Array): number {
  return (((a[0] ?? 0) & 0xff) << 16) | ((a[1] ?? 0) & 0xffff);
}

/**
 * Uint8Array(1) → 下位4bit 数値。
 * @param a セグメント系レジスタ
 */
export function fromReg4(a: Uint8Array): number {
  return (a[0] ?? 0) & 0xf;
}

export interface CpuRegisters {
  /** 汎用レジスタ R0 (16-bit) */
  R0: Uint16Array;
  /** 汎用レジスタ R1 (16-bit) */
  R1: Uint16Array;
  /** 汎用レジスタ R2 (16-bit) */
  R2: Uint16Array;
  /** 汎用レジスタ R3 (16-bit) */
  R3: Uint16Array;
  /** 汎用レジスタ R4 (16-bit) */
  R4: Uint16Array;
  /** スタックポインタ SP (24-bit: [0]=上位8, [1]=下位16) */
  SP: Uint16Array;
  /** ステータスレジスタ STR (24-bit: [0]=上位8, [1]=下位16) */
  STR: Uint16Array;
  /** インストラクションカウンタ IC (16-bit) */
  IC: Uint16Array;
  /** コードセグメントベースレジスタ CSBR（下位4bit） */
  CSBR: Uint8Array;
  /** スタックセグメントベースレジスタ SSBR（下位4bit） */
  SSBR: Uint8Array;
  /** タスクステータスレジスタ0 TSR0（下位4bit） */
  TSR0: Uint8Array;
  /** タスクステータスレジスタ1 TSR1（下位4bit） */
  TSR1: Uint8Array;
  /** ベース退避レジスタ OSR0（下位4bit） */
  OSR0: Uint8Array;
  /** ベース退避レジスタ OSR1（下位4bit） */
  OSR1: Uint8Array;
  /** ベース退避レジスタ OSR2（下位4bit） */
  OSR2: Uint8Array;
  /** ベース退避レジスタ OSR3（下位4bit） */
  OSR3: Uint8Array;
  /** ノーマルプロセスポインタ NPP (8-bit) */
  NPP: Uint16Array;
  /** 割り込み識別レジスタ IISR（下位1bit。未定義命令など） */
  IISR: boolean;
  /** セグメントベースレジスタバックアップ SBRB（下位4bit） */
  SBRB: Uint8Array;
  /** インストラクションカウンタバックアップ ICB (16-bit) */
  ICB: Uint16Array;
}
