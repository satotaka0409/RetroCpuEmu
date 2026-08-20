/**
 * JsonTestSettings からセッションを初期化する。
 * テスト対象は `.ihx` / `.cdb` のみ（`.asm` は読まない）。
 * 根拠: asm_test_framework.mdc
 */

import { resolveSuitePath } from "../json_suite.js";
import type { JsonTestSettings } from "../json_value.js";
import { createMn1613AsmSession, type Mn1613AsmSession } from "./session.js";
import type { CpuLogMode } from "../types.js";

/**
 * 設定の HEX / CDB パスを絶対パスにする。
 * @param settings テスト設定
 * @param fromDir 相対パスの基準（省略時は CWD）
 * @returns 解決済みパス
 */
export function resolveTestSettings(
  settings: JsonTestSettings,
  fromDir = process.cwd(),
): {
  hexFile: string;
  cdbFile: string;
  initLabel: string | null;
  cpu: JsonTestSettings["cpu"];
  ioMock: JsonTestSettings["ioMock"];
  cpuLogFile?: string;
  cpuLogMode?: CpuLogMode;
  maxCycles?: number;
} {
  const hexFile = resolveSuitePath(settings.hexFile, fromDir);
  const cdbFile = resolveSuitePath(settings.cdbFile, fromDir);
  const cpuLogFile = settings.cpuLogFile
    ? resolveSuitePath(settings.cpuLogFile, fromDir)
    : undefined;
  return {
    hexFile,
    cdbFile,
    initLabel: settings.initLabel,
    cpu: settings.cpu,
    ioMock: settings.ioMock,
    cpuLogFile,
    cpuLogMode: settings.cpuLogMode,
    maxCycles: settings.maxCycles,
  };
}

/**
 * JSON/TS 設定の HEX/CDB をロードしたセッションを作る。
 * `runInit()` は呼ばない。`ioMock` があれば reload 時に RD/WT をキックする。
 * @param settings テスト設定
 * @param fromDir 相対パス基準
 * @returns ロード済みセッション
 */
export function createSessionFromSettings(
  settings: JsonTestSettings,
  fromDir = process.cwd(),
): Mn1613AsmSession {
  const resolved = resolveTestSettings(settings, fromDir);
  if (resolved.cpu !== "mn1613") {
    throw new Error(
      `createSessionFromSettings currently supports mn1613 runtime only (got: ${resolved.cpu}). ` +
        "For tms9995, use assembleAndLink / assembleToHexCdb and byte-address assertions.",
    );
  }
  return createMn1613AsmSession({
    hexFile: resolved.hexFile,
    cdbFile: resolved.cdbFile,
    initLabel: resolved.initLabel,
    cpu: resolved.cpu,
    ioMock: resolved.ioMock,
    cpuLogFile: resolved.cpuLogFile,
    cpuLogMode: resolved.cpuLogMode,
    maxCycles: resolved.maxCycles,
  });
}
