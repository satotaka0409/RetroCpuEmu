/**
 * MN1613 CPUレジスタ状態
 *
 * 各フィールドは Uint16Array:
 * - 8/16-bit: length=1（値は [0]）
 * - 24-bit (SP/STR/OSR2): length=2（[0]=上位8bit, [1]=下位16bit）
 */

/** 8/16-bit レジスタ値を Uint16Array(1) にする */
export function reg16(v: number): Uint16Array {
  return Uint16Array.of(v & 0xffff);
}

/** 24-bit レジスタ値を Uint16Array(2) にする */
export function reg24(v: number): Uint16Array {
  return Uint16Array.of((v >>> 16) & 0xff, v & 0xffff);
}

/** Uint16Array(1) → 数値 */
export function fromReg16(a: Uint16Array): number {
  return (a[0] ?? 0) & 0xffff;
}

/** Uint16Array(2) → 24-bit 数値 */
export function fromReg24(a: Uint16Array): number {
  return (((a[0] ?? 0) & 0xff) << 16) | ((a[1] ?? 0) & 0xffff);
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
  /** コードセグメントベースレジスタ CSBR (16-bit) */
  CSBR: Uint16Array;
  /** スタックセグメントベースレジスタ SSBR (16-bit) */
  SSBR: Uint16Array;
  /** タスクステータスレジスタ0 TSR0 (16-bit) */
  TSR0: Uint16Array;
  /** タスクステータスレジスタ1 TSR1 (16-bit) */
  TSR1: Uint16Array;
  /** オペレーティングシステムレジスタ0 OSR0 (16-bit) */
  OSR0: Uint16Array;
  /** オペレーティングシステムレジスタ1 OSR1 (8-bit) */
  OSR1: Uint16Array;
  /** オペレーティングシステムレジスタ2 OSR2 (24-bit) */
  OSR2: Uint16Array;
  /** ノーマルプロセスポインタ NPP (8-bit) */
  NPP: Uint16Array;
  /** 割り込み識別レジスタ IISR (8-bit) */
  IISR: Uint16Array;
  /** セグメントベースレジスタバックアップ SBRB (8-bit) */
  SBRB: Uint16Array;
  /** インストラクションカウンタバックアップ ICB (16-bit) */
  ICB: Uint16Array;
}
