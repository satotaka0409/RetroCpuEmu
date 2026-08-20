/**
 * tms9995_mon のリンク設定。
 * 根拠: asm_test_framework.mdc / retrocpu_boot_monitor/Makefile
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CodeTestIoMockEntry,
  JsonTestSettings,
} from "../../../retrocpu_test_framework/src/index.js";

/** `logs/tms9995`（将来の実行ログ用） */
export const TMS9995_TEST_LOG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../logs/tms9995",
);

/**
 * モニタ結合テスト共通。
 * 入力は Makefile 成果物の `.ihx` / `.cdb` のみ（`.asm` は読まない）。
 */
export const tms9995MonSettings: JsonTestSettings = {
  name: "tms9995_mon",
  cpu: "tms9995",
  hexFile:
    "${REPO_ROOT}/retrocpu_boot_monitor/build/hex/tms9995/tms9995_mon.ihx",
  cdbFile:
    "${REPO_ROOT}/retrocpu_boot_monitor/build/hex/tms9995/tms9995_mon.cdb",
  initLabel: "g_main",
};

/**
 * ハンドシェイク結合用（MN1613 の ioMock 相当）。
 * TMS9995 は CRU モックをセッションが持つ。cpu 実行はコア実装後。
 */
export const tms9995MonHandshakeIoMock: CodeTestIoMockEntry[] = [
  { type: "handshake", timeoutMs: 5000, syncIrq2: false },
];

/** HEX/CDB + handshake 設定プレースホルダ（実行コア実装後に ioMock を有効化） */
export const tms9995MonHandshakeSettings: JsonTestSettings = {
  ...tms9995MonSettings,
  ioMock: tms9995MonHandshakeIoMock,
};
