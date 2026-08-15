/**
 * テスト専用 CPU ログ
 * 根拠: asm_test_framework.mdc §テスト専用 CPU ログ出力
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleToHexCdb } from "../src/assemble_link.js";
import {
  clearCpuLogsBeforeRun,
  mn1613LogsDirFromTestFile,
} from "../src/mn1613/cpu_log_clear.js";
import { endCpuLogTest } from "../src/cpu_log_mark.js";
import { createMn1613AsmSession } from "../src/mn1613/session.js";
import type { CpuLogMode } from "../src/types.js";
import { expect, test } from "../src/unit.js";

const ADD_SRC = [
  "\t.cpu\tmn1613",
  "\t.area\t_CODE (REL,CON)",
  "\t.org\t0x0200",
  "\t.globl\tgl_main",
  "\t.globl\tgl_add",
  "gl_main:",
  "\th",
  "gl_add:",
  "; @cp add_enter",
  "\ta\tR0, R1",
  "; @cp add_leave",
  "\tret",
  "",
].join("\n");

/**
 * フレームワーク単体用にインライン asm を HEX/CDB へ書き、セッションを開く。
 * 本番テストは事前ビルド済み成果物のみを読む。
 * @param dir 出力ディレクトリ
 * @param opts cpuLogFile / cpuLogMode
 * @returns セッション
 */
function sessionFromInlineAsm(
  dir: string,
  opts: { cpuLogFile?: string; cpuLogMode?: CpuLogMode } = {},
) {
  const hexFile = path.join(dir, "t.ihx");
  const cdbFile = path.join(dir, "t.cdb");
  assembleToHexCdb({
    sources: [{ module: "MAIN", text: ADD_SRC }],
    hexFile,
    cdbFile,
  });
  return createMn1613AsmSession({
    initLabel: "gl_main",
    hexFile,
    cdbFile,
    cpuLogFile: opts.cpuLogFile,
    cpuLogMode: opts.cpuLogMode,
  });
}

test("cpuLogFile 未指定ならログファイルを作らない", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-nolog-"));
  const logFile = path.join(dir, "cpu.log");
  const session = sessionFromInlineAsm(dir);
  await session.runInit();
  await session.call("gl_add", { registers: { R0: 3, R1: 4 } });
  session.expectRegisters({ R0: 7 });
  expect(fs.existsSync(logFile)).toBe(false);
});

test("cpuLogMode 指定なしは START/END だけ出す", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-titlelog-"));
  const logFile = path.join(dir, "cpu.log");
  const session = sessionFromInlineAsm(dir, {
    cpuLogFile: logFile,
  });
  await session.runInit();
  await session.call("gl_add", { registers: { R0: 3, R1: 4 } });
  session.expectRegisters({ R0: 7 });

  const text = fs.readFileSync(logFile, "utf8");
  expect(text).toContain("cpuLogMode 指定なしは START/END だけ出す START");
  expect(text).not.toContain("# runInit");
  expect(text).not.toContain("# call");
  expect(text.split("\n").filter((ln) => ln.includes("\t")).length).toBe(0);
});

test("cpuLogMode checkpoint は @cp の実行前・実行後だけ出す", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-cpulog-"));
  const logFile = path.join(dir, "cpu.log");
  const session = sessionFromInlineAsm(dir, {
    cpuLogFile: logFile,
    cpuLogMode: "checkpoint",
  });
  await session.runInit();
  await session.call("gl_add", { registers: { R0: 3, R1: 4 } });
  session.expectRegisters({ R0: 7 });

  const text = fs.readFileSync(logFile, "utf8");
  expect(text).toContain(
    "cpuLogMode checkpoint は @cp の実行前・実行後だけ出す START",
  );
  expect(text).toContain("# runInit gl_main");
  expect(text).toContain("# call gl_add");
  expect(text).not.toContain("\tH\t");

  const recs = text
    .split("\n")
    .filter((ln) => ln.includes("\t"))
    .map((ln) => ln.split("\t"));
  expect(recs.length).toBe(4);
  expect(recs[0]![3]).toBe("add_enter$0001");
  expect(recs[0]![4]).toBe("before");
  expect(recs[0]![5]).toBe("1");
  expect(recs[0]![6]).toBe("A R0, R1");
  expect(recs[0]![7]).toContain("R0=0003");
  expect(recs[0]![8]!.split(" ").length).toBe(16);
  expect(recs[1]![3]).toBe("add_enter$0001");
  expect(recs[1]![4]).toBe("after");
  expect(recs[1]![7]).toContain("R0=0007");
  expect(recs[2]![3]).toBe("add_leave$0001");
  expect(recs[2]![4]).toBe("before");
  expect(recs[3]![3]).toBe("add_leave$0001");
  expect(recs[3]![4]).toBe("after");

  await session.call("gl_add", { registers: { R0: 1, R1: 1 } });
  const text2 = fs.readFileSync(logFile, "utf8");
  const enterBeforeHits = text2
    .split("\n")
    .filter((ln) => ln.includes("\tadd_enter$0001\tbefore\t"))
    .map((ln) => ln.split("\t")[5]);
  expect(enterBeforeHits).toEqual(["1", "2"]);

  session.reload();
  await session.runInit();
  await session.call("gl_add", { registers: { R0: 2, R1: 2 } });
  const text3 = fs.readFileSync(logFile, "utf8");
  const afterReload = text3.slice(text3.lastIndexOf("# reload"));
  const hitAfterReload = afterReload
    .split("\n")
    .find((ln) => ln.includes("\tadd_enter$0001\tbefore\t"))
    ?.split("\t")[5];
  expect(hitAfterReload).toBe("1");
});

test("cpuLogMode instruction は全命令を実行後だけ出す", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-insnlog-"));
  const logFile = path.join(dir, "cpu.log");
  const session = sessionFromInlineAsm(dir, {
    cpuLogFile: logFile,
    cpuLogMode: "instruction",
  });
  await session.runInit();
  await session.call("gl_add", { registers: { R0: 3, R1: 4 } });
  session.expectRegisters({ R0: 7 });

  const callSection = fs
    .readFileSync(logFile, "utf8")
    .split("# call gl_add")[1]!
    .split("# ")[0]!;
  const recs = callSection
    .split("\n")
    .filter((ln) => ln.includes("\t"))
    .map((ln) => ln.split("\t"));
  // A / RET / 戻りスタブ H
  expect(recs.length).toBe(3);
  expect(recs.every((r) => r[4] === "after")).toBe(true);
  expect(recs.some((r) => r[4] === "before")).toBe(false);
  expect(recs[0]![3]).toBe("add_enter$0001");
  expect(recs[0]![6]).toBe("A R0, R1");
  expect(recs[0]![7]).toContain("R0=0007");
  expect(recs[1]![3]).toBe("add_leave$0001");
  expect(recs[1]![6]!.startsWith("RET")).toBe(true);
  expect(recs[2]![3]).toBe("-");
  expect(recs[2]![6]).toBe("H");

  const runInitSection = fs
    .readFileSync(logFile, "utf8")
    .split("# runInit gl_main")[1]!
    .split("# call")[0]!;
  const initRecs = runInitSection
    .split("\n")
    .filter((ln) => ln.includes("\t"))
    .map((ln) => ln.split("\t"));
  expect(initRecs.length).toBeGreaterThanOrEqual(1);
  expect(initRecs.every((r) => r[4] === "after")).toBe(true);
  expect(initRecs.some((r) => r[3] === "-" && r[6] === "H")).toBe(true);
});

test("全体テスト開始時は mn1613/logs の .log だけ消す", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-logclear-"));
  const testFile = path.join(root, "mn1613", "test", "bios", "bios_common_test.ts");
  const logDir = path.join(root, "mn1613", "logs");
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, "bios_common.log"), "old\n");
  fs.writeFileSync(path.join(logDir, "handshake_timer.log"), "old\n");
  fs.writeFileSync(path.join(logDir, "keep.txt"), "keep\n");

  expect(mn1613LogsDirFromTestFile(testFile)).toBe(logDir);
  expect(mn1613LogsDirFromTestFile(path.join(root, "test", "cpu_log.unit.ts"))).toBe(
    null,
  );

  const cleared = clearCpuLogsBeforeRun([
    testFile,
    path.join(root, "test", "cpu_log.unit.ts"),
  ]);
  expect(cleared).toEqual([{ dir: logDir, deleted: 2 }]);
  expect(fs.existsSync(path.join(logDir, "bios_common.log"))).toBe(false);
  expect(fs.existsSync(path.join(logDir, "handshake_timer.log"))).toBe(false);
  expect(fs.readFileSync(path.join(logDir, "keep.txt"), "utf8")).toBe("keep\n");
});

test("gl_rnd_init は非零の種をそのまま書く", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-casetitle-"));
  const logFile = path.join(dir, "cpu.log");
  const session = sessionFromInlineAsm(dir, { cpuLogFile: logFile });
  await session.runInit();
  endCpuLogTest("gl_rnd_init は非零の種をそのまま書く");
  const text = fs.readFileSync(logFile, "utf8");
  expect(text.split("\n")[0]).toBe(
    "gl_rnd_init は非零の種をそのまま書く START",
  );
  expect(text).toContain("gl_rnd_init は非零の種をそのまま書く END");
});
