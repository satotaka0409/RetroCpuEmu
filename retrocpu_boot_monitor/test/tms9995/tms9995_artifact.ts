/**
 * TMS9995 成果物セッション用ヘルパ。
 * CPU エミュ未実装のため call/runInit は不可（asm_test_framework.mdc）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTms9995SessionFromSettings,
  expect,
  type Tms9995ArtifactSession,
} from "../../../retrocpu_test_framework/src/index.js";
import {
  tms9995MonHandshakeSettings,
  tms9995MonSettings,
} from "./tms9995_mon_settings.js";

/**
 * 成果物セッションを作る。
 * @param handshake true なら handshake 設定（将来の実行テスト用）
 * @returns セッション
 */
export function createTmsMonSession(
  handshake = true,
): Tms9995ArtifactSession {
  const settings = handshake ? tms9995MonHandshakeSettings : tms9995MonSettings;
  return createTms9995SessionFromSettings(
    settings,
    path.dirname(fileURLToPath(import.meta.url)),
  );
}

/**
 * 必須シンボルが CDB にあり、非零アドレスであることを確認する。
 * @param session 成果物セッション
 * @param names ラベル名
 */
export function expectGlobals(
  session: Tms9995ArtifactSession,
  names: readonly string[],
): void {
  for (const name of names) {
    const addr = session.requireByteAddr(name);
    expect(addr > 0).toBe(true);
  }
}
