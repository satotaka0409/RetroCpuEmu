/**
 * JsonTestSettings から TMS9995 成果物セッションを作る。
 */

import { resolveSuitePath } from "../json_suite.js";
import type { JsonTestSettings } from "../json_value.js";
import {
  createTms9995ArtifactSession,
  type Tms9995ArtifactSession,
} from "./session.js";

/**
 * 設定の HEX/CDB から TMS9995 成果物セッションを作る。
 * 実行（call/runInit）は CPU エミュ未実装のため不可。
 * @param settings テスト設定（cpu は tms9995 であること）
 * @param fromDir 相対パス基準
 * @returns ロード済み成果物セッション
 */
export function createTms9995SessionFromSettings(
  settings: JsonTestSettings,
  fromDir = process.cwd(),
): Tms9995ArtifactSession {
  if (settings.cpu !== "tms9995") {
    throw new Error(
      `createTms9995SessionFromSettings requires cpu "tms9995" (got: ${settings.cpu})`,
    );
  }
  const hexFile = resolveSuitePath(settings.hexFile, fromDir);
  const cdbFile = resolveSuitePath(settings.cdbFile, fromDir);
  return createTms9995ArtifactSession({
    hexFile,
    cdbFile,
    attachCruHandshake: true,
  });
}
