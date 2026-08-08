/**
 * テスト設定の型
 * 根拠: test_framework.mdc
 */

import type { AsmCpuType } from "./types.js";

/**
 * HEX / CDB / CPU / ソースのテスト設定。
 * `createSessionFromSettings` が初期化時にアセンブルしてセッションを作る。
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
  /** テスト前処理 */
  beforeTest?: () => Promise<void> | void;
  /** テスト後処理 */
  afterTest?: () => Promise<void> | void;
  /** 各テスト前処理 */
  beforeEachTest?: () => Promise<void> | void;
  /** 各テスト後処理 */
  afterEachTest?: () => Promise<void> | void;
};
