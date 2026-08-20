/**
 * テストランナー開始時の CPU ログ削除
 * 根拠: asm_test_framework.mdc §テスト専用 CPU ログ出力
 */

import fs from "node:fs";
import path from "node:path";

/**
 * `.../test/mn1613/...`（旧: `.../mn1613/test/...`）からログディレクトリを求める。
 * @param testFile テストファイルの絶対パス
 * @returns `.../logs/mn1613`。対象外なら null
 */
export function mn1613LogsDirFromTestFile(testFile: string): string | null {
  const n = testFile.replace(/\\/g, "/");
  const modern = n.match(/^(.*)\/test\/mn1613(?:\/|$)/);
  if (modern) {
    return path.join(modern[1], "logs", "mn1613");
  }
  const legacy = n.match(/^(.*)\/mn1613\/test(?:\/|$)/);
  if (legacy) {
    return path.join(legacy[1], "logs", "mn1613");
  }
  return null;
}

/**
 * 1 ディレクトリ内の `*.log` を削除する。
 * @param dir ログディレクトリ
 * @returns 削除したファイル数（ディレクトリ無しは 0）
 */
export function clearCpuLogDir(dir: string): number {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return 0;
  }
  let deleted = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".log")) {
      continue;
    }
    fs.unlinkSync(path.join(dir, name));
    deleted += 1;
  }
  return deleted;
}

/**
 * 収集したテストファイルから `logs/mn1613` を特定し、既存 `.log` を消す。
 * CLI が全テスト実行の直前に 1 回呼ぶ。
 * @param testFiles 実行するテストの絶対パス
 * @returns 触ったディレクトリと削除数
 */
export function clearCpuLogsBeforeRun(
  testFiles: string[],
): { dir: string; deleted: number }[] {
  const dirs = new Set<string>();
  for (const f of testFiles) {
    const dir = mn1613LogsDirFromTestFile(f);
    if (dir) {
      dirs.add(dir);
    }
  }
  const out: { dir: string; deleted: number }[] = [];
  for (const dir of [...dirs].sort()) {
    out.push({ dir, deleted: clearCpuLogDir(dir) });
  }
  return out;
}
