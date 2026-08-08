/**
 * CLI 引数解析・CPU 切替のテスト
 *
 * 実行: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../main/assembler";
import { parseArgs } from "../main/cli";

describe("parseArgs: --cpu / -m 必須", () => {
  test("--cpu mn1613 を受け付ける", () => {
    const opts = parseArgs(["--cpu", "mn1613", "a.asm"]);
    assert.equal(opts.cpuType, "mn1613");
    assert.equal(opts.input, "a.asm");
  });

  test("-m mn1610 を受け付ける", () => {
    const opts = parseArgs(["a.asm", "-m", "mn1610"]);
    assert.equal(opts.cpuType, "mn1610");
    assert.equal(opts.input, "a.asm");
  });

  test("--cpu を入力ファイルの前に置いてもよい", () => {
    const opts = parseArgs(["--cpu", "mn1610", "foo.asm", "-o", "out.rel"]);
    assert.equal(opts.cpuType, "mn1610");
    assert.equal(opts.input, "foo.asm");
    assert.equal(opts.outRel, "out.rel");
  });

  test("-m と --lst / --module を併用できる", () => {
    const opts = parseArgs([
      "x.asm",
      "-m",
      "mn1613",
      "--lst",
      "x.lst",
      "--module",
      "MOD",
    ]);
    assert.equal(opts.cpuType, "mn1613");
    assert.equal(opts.outLst, "x.lst");
    assert.equal(opts.moduleName, "MOD");
  });

  test("-m tms9995 を受け付ける", () => {
    const opts = parseArgs(["a.asm", "-m", "tms9995"]);
    assert.equal(opts.cpuType, "tms9995");
  });

  test("未指定はエラー", () => {
    assert.throws(() => parseArgs(["a.asm"]), /--cpu \/ -m は必須/);
  });

  test("引数なしは Usage エラー", () => {
    assert.throws(() => parseArgs([]), /Usage: retrocpu_asm --cpu\|-m/);
  });

  test("不正な値はエラー", () => {
    assert.throws(
      () => parseArgs(["--cpu", "z80", "a.asm"]),
      /mn1610 \/ mn1613 \/ tms9995/,
    );
  });

  test("-m の値が無い場合はエラー", () => {
    assert.throws(
      () => parseArgs(["a.asm", "-m"]),
      /mn1610 \/ mn1613 \/ tms9995/,
    );
  });

  test("未知オプションはエラー", () => {
    assert.throws(
      () => parseArgs(["--cpu", "mn1613", "a.asm", "--unknown"]),
      /Unknown option/,
    );
  });
});

describe("assemble: CPU モード切替", () => {
  const awiSrc = ["        .org 0", "        AWI R0, #1", ""].join("\n");
  const balSrc = ["        .org 0", "L:      BAL L", ""].join("\n");

  test("mn1613 では AWI をアセンブルできる", () => {
    const r = assemble(awiSrc, "mn1613");
    assert.ok(r.words.length >= 1);
  });

  test("mn1610 では AWI がエラー", () => {
    assert.throws(() => assemble(awiSrc, "mn1610"), /MN1613 専用命令/);
  });

  test("mn1610 でも BAL はアセンブルできる", () => {
    const r = assemble(balSrc, "mn1610");
    assert.ok(r.words.length >= 1);
  });

  test("parseArgs の cpuType を assemble に渡せる", () => {
    const opts = parseArgs(["--cpu", "mn1610", "dummy.asm"]);
    assert.throws(
      () => assemble(awiSrc, opts.cpuType),
      /MN1613 専用命令/,
    );
    const opts13 = parseArgs(["-m", "mn1613", "dummy.asm"]);
    const r = assemble(awiSrc, opts13.cpuType);
    assert.ok(r.words.length >= 1);
  });

  test("tms9995 で LI をアセンブルできる", () => {
    const opts = parseArgs(["--cpu", "tms9995", "dummy.asm"]);
    const r = assemble("        .org 0\n        LI R1, >1234\n", opts.cpuType);
    assert.equal(r.addressUnit, "byte");
    assert.deepEqual(
      r.words.map((w) => w.value),
      [0x0201, 0x1234],
    );
  });
});
