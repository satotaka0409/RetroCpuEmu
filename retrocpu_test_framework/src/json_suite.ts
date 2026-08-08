/**
 * テスト設定パスのプレースホルダ展開
 * 根拠: test_framework.mdc
 */

import fs from "node:fs";
import path from "node:path";
import { FRAMEWORK_BUILD, MONITOR_HEX, MONITOR_SRC, REPO_ROOT } from "./repo.js";

const PLACEHOLDERS: Record<string, string> = {
  MONITOR_SRC,
  MONITOR_HEX,
  FRAMEWORK_BUILD,
  REPO_ROOT,
};

/**
 * `${MONITOR_SRC}` などのプレースホルダを展開する。
 * @param text 文字列
 * @returns 展開後
 */
export function expandPlaceholders(text: string): string {
  return text.replace(/\$\{([A-Z_]+)\}/g, (all, key: string) => {
    const v = PLACEHOLDERS[key];
    if (v === undefined) {
      throw new Error(`Unknown placeholder ${all}`);
    }
    return v;
  });
}

/**
 * 設定内のパスを絶対パスにする（基準ディレクトリ → リポジトリルートの順）。
 * @param spec パス文字列
 * @param fromDir 相対パスの基準
 * @returns 絶対パス
 */
export function resolveSuitePath(spec: string, fromDir: string): string {
  const expanded = expandPlaceholders(spec);
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  const fromHere = path.resolve(fromDir, expanded);
  if (fs.existsSync(fromHere)) {
    return fromHere;
  }
  const fromRepo = path.resolve(REPO_ROOT, expanded);
  if (fs.existsSync(fromRepo)) {
    return fromRepo;
  }
  return fromHere;
}
