/**
 * mn1613_mon のリンク設定（Makefile の ASM_SRCS と同じ）。
 * 根拠: asm_test_framework.mdc / retrocpu_boot_monitor/Makefile / emulater_code_test.mdc
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CodeTestIoMockEntry,
  CpuLogMode,
  JsonTestSettings,
} from "../../../retrocpu_test_framework/src/index.js";

/** `mn1613/logs`（テスト専用 CPU ログ） */
export const MN1613_TEST_LOG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../logs",
);

/**
 * `*_test.ts` に対応する asm 名の `.log` を `cpuLogFile` に付ける。
 * `handshake_timer_test.ts` → `mn1613/logs/handshake_timer.log`
 * @param settings 元設定
 * @param testMetaUrl 呼び出し元の `import.meta.url`
 * @param opts 任意。`cpuLogMode` など
 * @returns cpuLogFile 付き設定
 */
export function withMn1613CpuLog(
  settings: JsonTestSettings,
  testMetaUrl: string,
  opts?: { cpuLogMode?: CpuLogMode },
): JsonTestSettings {
  const envMode = process.env.MN1613_CPU_LOG_MODE;
  const envCpuLogMode: CpuLogMode | undefined =
    envMode === "checkpoint" || envMode === "instruction" ? envMode : undefined;
  const selectedMode = opts?.cpuLogMode ?? envCpuLogMode;
  const stem = path
    .basename(fileURLToPath(testMetaUrl))
    .replace(/_test\.ts$/i, "");
  return {
    ...settings,
    cpuLogFile: path.join(MN1613_TEST_LOG_DIR, `${stem}.log`),
    ...(selectedMode ? { cpuLogMode: selectedMode } : {}),
  };
}

/**
 * モニタ結合テスト共通。
 * 入力は Makefile 成果物の `.ihx` / `.cdb` のみ（`.asm` は読まない）。
 */
export const mn1613MonSettings: JsonTestSettings = {
  name: "mn1613_mon",
  cpu: "mn1613",
  hexFile: "${MONITOR_HEX}/mn1613_mon.ihx",
  cdbFile: "${MONITOR_HEX}/mn1613_mon.cdb",
  initLabel: "g_main",
};

/** ハンドシェイク結合テスト用 ioMock（emulater_code_test.mdc §7） */
export const mn1613MonHandshakeIoMock: CodeTestIoMockEntry[] = [
  { type: "handshake", timeoutMs: 5000, syncIrq2: false },
];

/** HEX/CDB + handshake ioMock。reload で RD/WT をキックする */
export const mn1613MonHandshakeSettings: JsonTestSettings = {
  ...mn1613MonSettings,
  ioMock: mn1613MonHandshakeIoMock,
};
