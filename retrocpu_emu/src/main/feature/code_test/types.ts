/**
 * コードテスト・ミドルウェア共通型
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

import type { CPURegister } from "../cpu/mn1613/mn1613";

/** 呼び出し時に設定できるレジスタ（部分） */
export type CallRegisters = {
  R0?: number;
  R1?: number;
  R2?: number;
  R3?: number;
  R4?: number;
  SP?: number;
  STR?: number;
  CSBR?: number;
  SSBR?: number;
  TSR0?: number;
  TSR1?: number;
};

export type CallOptions = {
  /** レジスタ初期値（部分指定） */
  registers?: CallRegisters;
  /**
   * 戻りアドレスより前に PUSH するワード列。
   * 先頭要素が先に PUSH される（最終的にアドレスが高い側）。
   */
  stack?: number[];
};

export type CallResult = {
  status: string;
  registers: CPURegister;
  /** call 直前の SP（スタックワーク検証の基準） */
  preCallSp: number;
  /** 呼び出した入口（ワードアドレス） */
  entryWordAddr: number;
};

export type Mn1613CodeTestOptions = {
  /** スタック初期値（空きスロットを指す）。既定 0xFFFF */
  stackInit?: number;
  /** 戻りスタブ（H）を置くワードアドレス。既定 0x17FE */
  returnStubWordAddr?: number;
  /** run の最大サイクル。既定 100000 */
  maxCycles?: number;
  /** メモリバイト数。既定 512KB（256K ワード） */
  memoryBytes?: number;
};

export type StackWorkExpect = {
  /** preCallSp からの差分（+1 で 1 ワード上＝アドレス増） */
  from: "preCallSp";
  offset: number;
  words: number[];
};

export type CdbSymbol = {
  name: string;
  /** CDB 上のバイトアドレス */
  byteAddr: number;
  /** ワードアドレス（byteAddr/2） */
  wordAddr: number;
  scope: "G" | "F" | "L" | string;
};
