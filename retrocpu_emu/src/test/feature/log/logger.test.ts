/**
 * IO ボードのログ出力（Winston）
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getLogFilePath,
  getLogger,
  initLogging,
} from "../../../main/feature/log/logger";

const dirs: string[] = [];

/**
 * テスト用の一時ログディレクトリを作る（afterEach で削除される）。
 * @returns 作成したディレクトリのパス
 */
function makeTmpDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "retrocpu-log-"));
  dirs.push(dir);
  return dir;
}

/**
 * ファイルに内容が書かれるまで待つ（Winston の書き込みは非同期）。
 * @param file 監視するファイルパス
 * @param timeoutMs 待ち時間上限（ミリ秒）
 * @returns 読み取った内容
 * @throws 期限内に書かれなかった場合
 */
async function waitForFile(file: string, timeoutMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      if (text.trim().length > 0) return text;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`ログファイルが書かれない: ${file}`);
}

describe("logger", () => {
  afterEach(() => {
    initLogging({ source: "main" });
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("dir 未指定ならファイルを作らない", () => {
    initLogging({ source: "io" });
    expect(getLogFilePath()).toBeNull();
    getLogger("panel").info("ファイルなし");
  });

  it("dir 指定でファイルに JSON 1 行を書く", async () => {
    const dir = makeTmpDir();
    initLogging({ source: "io", dir, level: "debug" });

    const file = getLogFilePath();
    expect(file).toBe(path.join(dir, "ioboard.log"));

    getLogger("panel").info("ファンクションキー", { fn: "F5", addr: 0x1800 });

    const text = await waitForFile(file!);
    const rec = JSON.parse(text.trim().split("\n")[0]!) as Record<
      string,
      unknown
    >;
    expect(rec.message).toBe("ファンクションキー");
    expect(rec.level).toBe("info");
    expect(rec.src).toBe("io");
    expect(rec.scope).toBe("panel");
    expect(rec.fn).toBe("F5");
    expect(rec.addr).toBe(0x1800);
    expect(typeof rec.timestamp).toBe("string");
  });

  it("error は専用ファイルにも出る", async () => {
    const dir = makeTmpDir();
    initLogging({ source: "io", dir });

    getLogger("io").error("DMA 失敗", { err: "timeout" });

    const text = await waitForFile(path.join(dir, "ioboard-error.log"));
    expect(text).toContain("DMA 失敗");
  });

  it("再初期化で前のファイル出力先を捨てる", async () => {
    const first = makeTmpDir();
    initLogging({ source: "io", dir: first, level: "info" });
    getLogger("io").info("1回目");
    await waitForFile(path.join(first, "ioboard.log"));

    const second = makeTmpDir();
    initLogging({ source: "cpu", dir: second, level: "info" });
    getLogger("cpu").info("2回目");
    await waitForFile(path.join(second, "ioboard.log"));

    expect(readFileSync(path.join(first, "ioboard.log"), "utf8")).not.toContain(
      "2回目",
    );
  });
});
