/**
 * テスト設定の型
 * 根拠: test_framework.mdc / emulater_code_test.mdc §7
 */

import type { CodeTestIoMockEntry } from "../../retrocpu_emu/src/main/feature/code_test/types.js";
import type { AsmCpuType } from "./types.js";

/**
 * HEX / CDB / CPU / ソースのテスト設定。
 * `createSessionFromSettings` が初期化時にアセンブルしてセッションを作る。
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
  /** ソースルートパス（`${MONITOR_SRC}` 可） */
  sourceRoot: string;
  /** ソースファイル（sourceRoot 相対） */
  sources: {
    file: string;
    module?: string;
  }[];
  /**
   * IO モックエントリ。1 件以上ならセッション作成／reload で RD/WT を差し替える。
   * `{ type: "handshake" }` / `{ type: "port", port, read }`（emulater_code_test.mdc）
   */
  ioMock?: CodeTestIoMockEntry[];
  /** テスト前処理 */
  beforeTest?: () => Promise<void> | void;
  /** テスト後処理 */
  afterTest?: () => Promise<void> | void;
  /** 各テスト前処理 */
  beforeEachTest?: () => Promise<void> | void;
  /** 各テスト後処理 */
  afterEachTest?: () => Promise<void> | void;
};
