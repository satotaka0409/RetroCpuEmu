/**
 * アセンブラ／リンカ CLI のエラー終了テスト
 *
 * 例外でスタックを吐かず、stderr にメッセージだけ出して exit 1 になることを検証する。
 *
 * 実行: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DIST_MAIN = path.resolve(__dirname, "../main");
const ASM_CLI = path.join(DIST_MAIN, "cli.js");

/**
 * Node で CLI を同期実行する。
 * @param scriptPath dist 上の CLI パス
 * @param args CLI 引数
 * @returns status / stdout / stderr
 */
function runCli(
  scriptPath: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    env: process.env,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/**
 * 一時ディレクトリに asm を書いてパスを返す。
 * @param name ファイル名
 * @param body ソース
 * @returns 絶対パスと掃除用ディレクトリ
 */
function writeTempAsm(
  name: string,
  body: string,
): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retrocpu-asm-cli-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, "utf8");
  return { dir, file };
}

/**
 * スタックトレースっぽい行が stderr に無いことを確認する。
 * @param stderr CLI の stderr
 */
function assertNoStackTrace(stderr: string): void {
  assert.doesNotMatch(stderr, /^\s*at /m);
  assert.doesNotMatch(stderr, /node:internal/);
  assert.doesNotMatch(stderr, /\.js:\d+:\d+/);
}

describe("asm CLI: エラー時はメッセージのみで exit 1", () => {
  test("入力ファイルが無い", () => {
    const missing = path.join(os.tmpdir(), "retrocpu-asm-missing-nope.asm");
    const r = runCli(ASM_CLI, [missing]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Input file not found/);
    assert.equal(r.stdout, "");
    assertNoStackTrace(r.stderr);
  });

  test("未定義シンボルはメッセージのみ", () => {
    const { dir, file } = writeTempAsm(
      "undef.asm",
      "\t.cpu\tmn1613\n\t.org\t0\n\tB\tUNDEF\n",
    );
    try {
      const r = runCli(ASM_CLI, [file, "-o", path.join(dir, "out.rel")]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Undefined symbol:\s*UNDEF/i);
      assert.equal(r.stdout, "");
      assertNoStackTrace(r.stderr);
      assert.equal(fs.existsSync(path.join(dir, "out.rel")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("未知命令はメッセージのみ", () => {
    const { dir, file } = writeTempAsm(
      "badop.asm",
      "\t.cpu\tmn1613\n\t.org\t0\n\tFOOBAR\tR0\n",
    );
    try {
      const r = runCli(ASM_CLI, [file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Unsupported opcode 'FOOBAR'/);
      assertNoStackTrace(r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("不正な --cpu はメッセージのみ", () => {
    const { dir, file } = writeTempAsm(
      "cpu.asm",
      "\t.cpu\tmn1613\n\t.org\t0\n\tH\n",
    );
    try {
      const r = runCli(ASM_CLI, ["--cpu", "z80", file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /mn1613 \/ tms9995/);
      assertNoStackTrace(r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("引数なしは Usage を出して exit 1", () => {
    const r = runCli(ASM_CLI, []);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage: retrocpu_asm/);
    assertNoStackTrace(r.stderr);
  });

  test("インデックスに R2 を使うとメッセージのみ", () => {
    const { dir, file } = writeTempAsm(
      "idx.asm",
      "\t.cpu\tmn1613\n\t.org\t0\n\tL\tR0, 0(R2)\n",
    );
    try {
      const r = runCli(ASM_CLI, [file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /index register must be X0 or X1/);
      assert.match(r.stderr, /R2/);
      assertNoStackTrace(r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
