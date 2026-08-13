/**
 * テスト設定の型
 * 根拠: asm_test_framework.mdc / emulater_code_test.mdc §7
 */

import type { CodeTestIoMockEntry } from "../../retrocpu_emu/src/code_test/types.js";
import type { AsmCpuType, CpuLogMode } from "./types.js";

/**
 * HEX / CDB / CPU のテスト設定。
 * テスト対象の入力は **Intel HEX と CDB のみ**（`.asm` は読まない）。
 * アセンブルは Makefile 等で事前に行い、成果物パスを書く。
 * `ioMock` があれば RD/WT をキックする（emulater_code_test.mdc）。
 */
export type JsonTestSettings = {
  /** テスト名 */
  name: string;
  /** CPU 種別 */
  cpu: AsmCpuType;
  /** HEX ファイルパス（`${MONITOR_HEX}` / `${FRAMEWORK_BUILD}` 可） */
  hexFile: string;
  /** CDB ファイルパス（`${MONITOR_HEX}` / `${FRAMEWORK_BUILD}` 可） */
  cdbFile: string;
  /** 初期ラベル。`null` なら runInit しない */
  initLabel: string | null;
  /**
   * IO モックエントリ。1 件以上ならセッション作成／reload で RD/WT を差し替える。
   * `{ type: "handshake" }` / `{ type: "port", port, read }`（emulater_code_test.mdc）
   */
  ioMock?: CodeTestIoMockEntry[];
  /**
   * テスト専用 CPU ログの出力パス。未指定／空なら出力しない。
   * `${FRAMEWORK_BUILD}` 可。通常のエミュレータ実行では使わない。
   */
  cpuLogFile?: string;
  /**
   * CPU ログの本文モード。`cpuLogFile` 指定時のみ有効。
   * 省略時は START/END のみ。`checkpoint` / `instruction` で本文を出す。
   */
  cpuLogMode?: CpuLogMode;
  /** テスト前処理 */
  beforeTest?: () => Promise<void> | void;
  /** テスト後処理 */
  afterTest?: () => Promise<void> | void;
  /** 各テスト前処理 */
  beforeEachTest?: () => Promise<void> | void;
  /** 各テスト後処理 */
  afterEachTest?: () => Promise<void> | void;
};
