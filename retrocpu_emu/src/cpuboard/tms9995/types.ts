/**
 * TMS9995 コアの型。
 * 根拠: TMS9995_instruction.mdc / TMS9995_hardware.mdc
 */

/** 実行状態（Worker の EXEC_CODE と対応） */
export type TmsExecStatus =
  | "idle"
  | "running"
  | "step"
  | "break"
  | "halted";

/** 内部固定レジスタ + 派生 */
export type TmsCpuState = {
  /** Program Counter（バイトアドレス、偶数） */
  PC: number;
  /** Workspace Pointer（バイトアドレス、偶数） */
  WP: number;
  /** Status（TI bit0=MSB） */
  ST: number;
};

/** ピン（CPU から見た入出力。MN1613 と揃えて Worker 互換） */
export type TmsCpuPins = {
  HLT: boolean;
  RUN: boolean;
  RST: boolean;
  /** INT1*（ハンドシェイク）。アクティブで要求 */
  IRQ1: boolean;
  /** INT2*（ブレイク／ステップ） */
  IRQ2: boolean;
  /** INT3 / 内蔵タイマ相当（レベル3） */
  IRQ3: boolean;
  /** NMI* / LOAD* */
  NMI: boolean;
};

/** ST ビット（TI: bit0 = MSB = 0x8000） */
export const ST_LGT = 0x8000;
export const ST_AGT = 0x4000;
export const ST_EQ = 0x2000;
export const ST_C = 0x1000;
export const ST_OV = 0x0800;
export const ST_OP = 0x0400;
export const ST_X = 0x0200;
export const ST_IMASK = 0x000f;

/** メモリサイズ（バイト）。ボードは 64KB アドレス */
export const TMS_MEM_BYTES = 0x10000;
