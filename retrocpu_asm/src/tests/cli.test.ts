/**
 * CLI 引数解析・CPU 切替のテスト
 *
 * 実行: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../main/assembler";
import { parseArgs } from "../main/cli";

describe("parseArgs: --cpu / -m 任意（無ければソース .cpu）", () => {
  test("--cpu mn1613 を受け付ける", () => {
    const opts = parseArgs(["--cpu", "mn1613", "a.asm"]);
    assert.equal(opts.cpuType, "mn1613");
    assert.equal(opts.input, "a.asm");
  });

  test("-m mn1613 を受け付ける", () => {
    const opts = parseArgs(["a.asm", "-m", "mn1613"]);
    assert.equal(opts.cpuType, "mn1613");
    assert.equal(opts.input, "a.asm");
  });

  test("--cpu を入力ファイルの前に置いてもよい", () => {
    const opts = parseArgs(["--cpu", "mn1613", "foo.asm", "-o", "out.rel"]);
    assert.equal(opts.cpuType, "mn1613");
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

  test("未指定でも parseArgs は通る（.cpu は assemble 側）", () => {
    const opts = parseArgs(["a.asm"]);
    assert.equal(opts.input, "a.asm");
    assert.equal(opts.cpuType, undefined);
  });

  test("-m tms9995 を受け付ける", () => {
    const opts = parseArgs(["a.asm", "-m", "tms9995"]);
    assert.equal(opts.cpuType, "tms9995");
  });

  test("引数なしは Usage エラー", () => {
    assert.throws(() => parseArgs([]), /Usage: retrocpu_asm \[--cpu\|-m/);
  });

  test("不正な値はエラー", () => {
    assert.throws(
      () => parseArgs(["--cpu", "z80", "a.asm"]),
      /mn1613 \/ tms9995/,
    );
  });

  test("-m の値が無い場合はエラー", () => {
    assert.throws(() => parseArgs(["a.asm", "-m"]), /mn1613 \/ tms9995/);
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

  test(".cpu mn1613 だけで AWI をアセンブルできる", () => {
    const r = assemble("\t.cpu\tmn1613\n        .org 0\n        AWI R0, #1\n");
    assert.ok(r.words.length >= 1);
    assert.equal(r.cpuType, "mn1613");
  });

  test(".CPU MN1613 は大文字小文字を無視する", () => {
    const r = assemble("\t.CPU\tMN1613\n        .org 0\n        H\n");
    assert.equal(r.cpuType, "mn1613");
  });

  test(".cpu も引数も無ければエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        H\n"),
      /CPU が未指定/,
    );
  });

  test(".cpu が先頭以外ならエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n\t.cpu\tmn1613\n        H\n"),
      /\.cpu must be the first non-comment line/,
    );
  });

  test(".cpu は mn1613 / tms9995 以外を拒否する", () => {
    assert.throws(
      () => assemble("\t.cpu\tz8002\n        .org 0\n        H\n"),
      /unknown \.cpu 'z8002' \(mn1613 \/ tms9995\)/,
    );
    assert.throws(
      () => assemble("\t.cpu\tz80\n        .org 0\n        H\n"),
      /unknown \.cpu 'z80'/,
    );
  });

  test("mn1613 では AWI をアセンブルできる", () => {
    const r = assemble(awiSrc, "mn1613");
    assert.ok(r.words.length >= 1);
  });

  test("parseArgs の cpuType を assemble に渡せる", () => {
    const opts13 = parseArgs(["-m", "mn1613", "dummy.asm"]);
    const r = assemble(awiSrc, opts13.cpuType);
    assert.ok(r.words.length >= 1);
  });

  test("tms9995 で LI をアセンブルできる", () => {
    const opts = parseArgs(["--cpu", "tms9995", "dummy.asm"]);
    const r = assemble(
      "        .org 0\n        LI R1, #0x1234\n",
      opts.cpuType,
    );
    assert.equal(r.addressUnit, "byte");
    assert.deepEqual(
      r.words.map((w) => w.value),
      [0x0201, 0x1234],
    );
  });
});
