#!/usr/bin/env node
/**
 * 独自テストランナー CLI
 * 根拠: test_framework.mdc
 *
 * Usage: tsx src/cli.ts [paths...]
 * 省略時はフレームワーク test 配下のみ（unit.ts / _test.ts）。
 * モニタの結合テストは retrocpu_boot_monitor 側でパスを渡して実行する。
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FRAMEWORK_ROOT, REPO_ROOT } from "./repo.js";
import { takeUnitTests } from "./unit.js";

/**
 * ディレクトリを再帰してマッチするファイルを集める。
 * @param dir 起点
 * @param pred ファイル判定
 * @returns 絶対パス一覧
 */
function walkFiles(dir: string, pred: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(p, pred));
    } else if (pred(p)) {
      out.push(p);
    }
  }
  return out.sort();
}

/**
 * ユニット／結合テストファイルを import して実行する。
 * @param file 絶対パス
 * @returns 失敗数
 */
async function runUnitFile(file: string): Promise<{ fail: number; total: number }> {
  takeUnitTests();
  await import(pathToFileURL(file).href);
  const cases = takeUnitTests();
  const rel = path.relative(REPO_ROOT, file);
  console.log(`\n${rel}`);
  let fail = 0;
  for (const c of cases) {
    const t0 = Date.now();
    try {
      await c.fn();
      console.log(`  ok  ${c.name} (${Date.now() - t0}ms)`);
    } catch (e) {
      fail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`  FAIL  ${c.name} (${Date.now() - t0}ms)`);
      console.log(`        ${msg}`);
    }
  }
  return { fail, total: cases.length };
}

/**
 * CLI エントリ。
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const testDir = path.join(FRAMEWORK_ROOT, "test");
  const unitFiles: string[] = [];

  if (args.length === 0) {
    unitFiles.push(...walkFiles(testDir, (f) => f.endsWith(".unit.ts")));
    unitFiles.push(...walkFiles(testDir, (f) => f.endsWith("_test.ts")));
  } else {
    for (const a of args) {
      const p = path.resolve(a);
      if (fs.statSync(p).isDirectory()) {
        unitFiles.push(...walkFiles(p, (f) => f.endsWith(".unit.ts")));
        unitFiles.push(...walkFiles(p, (f) => f.endsWith("_test.ts")));
      } else if (p.endsWith(".unit.ts") || p.endsWith("_test.ts")) {
        unitFiles.push(p);
      } else {
        throw new Error(`Unknown test file: ${p}`);
      }
    }
  }

  let fail = 0;
  let total = 0;

  for (const f of unitFiles) {
    const r = await runUnitFile(f);
    fail += r.fail;
    total += r.total;
  }

  console.log(`\n${total - fail} passed, ${fail} failed, ${total} total`);
  if (total === 0) {
    console.error("No tests found");
    process.exit(1);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
