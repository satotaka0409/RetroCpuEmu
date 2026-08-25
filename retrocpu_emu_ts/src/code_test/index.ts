/**
 * アセンブラ／C 成果物のエミュレータ検証ミドルウェア
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

export { createMn1613CodeTest, Mn1613CodeTest, readWord, writeWord, readBytes, writeBytes } from "./mn1613_harness";
export {
  createTms9995CodeTest,
  Tms9995CodeTest,
  readWord as tmsReadWord,
  writeWord as tmsWriteWord,
} from "./tms9995_harness";
export {
  loadIntelHex,
  wordsToIntelHex,
  bytesToIntelHex,
  intelHexToDmaPlan,
} from "./intel_hex";
export {
  parseCdb,
  parseTms9995Cdb,
  requireSymbol,
  requireTms9995Symbol,
  checkpointIdsByWordAddr,
  emptyCdbTable,
  type CdbTable,
} from "./cdb";
export { CodeTestIoMock, parseJsonInt, parseJsonNumber, resetDefaultIoCallbacks } from "./io_mock";
export {
  createMn1613CodeTestFromSettings,
  loadCodeTestSettingsFile,
  parseCodeTestSettings,
} from "./settings";
export type {
  CallOptions,
  CallRegisters,
  CallResult,
  CdbCheckpoint,
  CdbSymbol,
  CodeTestIoMockEntry,
  CodeTestIoWriteLog,
  CodeTestSettings,
  Mn1613CodeTestOptions,
  Tms9995CodeTestOptions,
  StackWorkExpect,
} from "./types";
