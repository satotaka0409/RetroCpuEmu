/**
 * JsonTestSettings からセッションを初期化する
 * 根拠: test_framework.mdc
 */

import path from "node:path";
import { assembleToHexCdb } from "./assemble_link.js";
import { expandPlaceholders, resolveSuitePath } from "./json_suite.js";
import type { JsonTestSettings } from "./json_value.js";
import {
  createMn1613AsmSession,
  type Mn1613AsmSession,
} from "./mn1613_session.js";
import type { AsmSource } from "./types.js";

/**
 * 設定の HEX / CDB / ソースパスを絶対パスにする。
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
  sources: AsmSource[];
} {
  const hexFile = resolveSuitePath(settings.hexFile, fromDir);
  const cdbFile = resolveSuitePath(settings.cdbFile, fromDir);
  const root = expandPlaceholders(settings.sourceRoot);
  const sources: AsmSource[] = settings.sources.map((s) => {
    const file = path.isAbsolute(s.file) ? s.file : path.resolve(root, s.file);
    return s.module ? { file, module: s.module } : { file };
  });
  return {
    hexFile,
    cdbFile,
    initLabel: settings.initLabel,
    cpu: settings.cpu,
    sources,
  };
}

/**
 * JSON/TS 設定からアセンブルし、HEX/CDB をロードしたセッションを作る。
 * `runInit()` は呼ばない（モック attach 後に呼ぶ）。
 * @param settings テスト設定
 * @param fromDir 相対パス基準
 * @returns ロード済みセッション
 */
export function createSessionFromSettings(
  settings: JsonTestSettings,
  fromDir = process.cwd(),
): Mn1613AsmSession {
  const resolved = resolveTestSettings(settings, fromDir);
  if (resolved.sources.length > 0) {
    assembleToHexCdb({
      sources: resolved.sources,
      cpu: resolved.cpu,
      hexFile: resolved.hexFile,
      cdbFile: resolved.cdbFile,
    });
  }
  return createMn1613AsmSession({
    hexFile: resolved.hexFile,
    cdbFile: resolved.cdbFile,
    initLabel: resolved.initLabel,
    cpu: resolved.cpu,
  });
}
