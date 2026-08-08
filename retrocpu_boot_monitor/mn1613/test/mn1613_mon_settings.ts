/**
 * mn1613_mon のリンク設定（Makefile の ASM_SRCS と同じ）。
 * 根拠: test_framework.mdc / retrocpu_boot_monitor/Makefile / emulater_code_test.mdc
 */
import type {
  CodeTestIoMockEntry,
  JsonTestSettings,
} from "../../../retrocpu_test_framework/src/index.js";

/** モニタ結合テスト共通。成果物は `build/hex/mn1613_mon.ihx` */
export const mn1613MonSettings: JsonTestSettings = {
  name: "mn1613_mon",
  cpu: "mn1613",
  hexFile: "${MONITOR_HEX}/mn1613_mon.ihx",
  cdbFile: "${MONITOR_HEX}/mn1613_mon.cdb",
  initLabel: "gl_main",
  sourceRoot: "${MONITOR_SRC}",
  sources: [
    { file: "main.asm", module: "MAIN" },
    { file: "interrupt.asm" },
    { file: "handshake/handshake_common.asm" },
    { file: "handshake/handshake_main.asm" },
    { file: "handshake/handshake_timer.asm" },
    { file: "bios/bios_common.asm" },
  ],
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
