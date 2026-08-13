/**
 * CDB シンボル／チェックポイント型（debug_expand 用の最小定義）
 * 根拠: emulater_code_test.mdc / retrocpu_emu code_test/types.ts
 */

/** CDB ラベル（L: レコード） */
export type CdbSymbol = {
  name: string;
  /** バイトアドレス */
  byteAddr: number;
  /** ワードアドレス（byteAddr/2） */
  wordAddr: number;
  /** G / F / L など */
  scope: string;
};

/** `; @cp` 由来のチェックポイント */
export type CdbCheckpoint = {
  id: string;
  name: string;
  serial: string;
  byteAddr: number;
  wordAddr: number;
};
