import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** RetroCpuEmu リポジトリルート */
export const REPO_ROOT = path.resolve(here, "../..");

/** retrocpu_test_framework ルート */
export const FRAMEWORK_ROOT = path.resolve(here, "..");

/** テスト成果物（HEX / CDB）の既定出力先 */
export const FRAMEWORK_BUILD = path.join(FRAMEWORK_ROOT, "build");

/** retrocpu_asm の dist/main */
export const ASM_DIST = path.join(REPO_ROOT, "retrocpu_asm/dist/main");

/** retrocpu_boot_monitor/mn1613/src */
export const MONITOR_SRC = path.join(
  REPO_ROOT,
  "retrocpu_boot_monitor/mn1613/src",
);

/** retrocpu_boot_monitor/build/hex（mn1613_mon.ihx / .cdb） */
export const MONITOR_HEX = path.join(
  REPO_ROOT,
  "retrocpu_boot_monitor/build/hex",
);

/** retrocpu_boot_monitor/mn1613/test（asm と同列のテスト） */
export const MONITOR_TEST = path.join(
  REPO_ROOT,
  "retrocpu_boot_monitor/mn1613/test",
);

/**
 * リポジトリ相対パスを絶対パスにする。
 * @param rel RetroCpuEmu からの相対パス
 * @returns 絶対パス
 */
export function repoPath(...rel: string[]): string {
  return path.join(REPO_ROOT, ...rel);
}
