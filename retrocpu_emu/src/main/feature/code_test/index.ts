/**
 * アセンブラ／C 成果物のエミュレータ検証ミドルウェア
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

export { createMn1613CodeTest, Mn1613CodeTest, readWord, writeWord, readBytes, writeBytes } from "./mn1613_harness";
export { loadIntelHex, wordsToIntelHex } from "./intel_hex";
export { parseCdb, requireSymbol } from "./cdb";
export type {
  CallOptions,
  CallRegisters,
  CallResult,
  CdbSymbol,
  Mn1613CodeTestOptions,
  StackWorkExpect,
} from "./types";
