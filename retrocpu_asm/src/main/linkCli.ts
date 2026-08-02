#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { linkRelTexts } from "./linker";

/**
 * リンカ CLI オプション
 */
interface LinkCliOptions {
  inputs: string[];
  outBin?: string;
}

/**
 * 引数を解析する。
 * @param argv - process.argv.slice(2)
 * @return オプション
 */
function parseArgs(argv: string[]): LinkCliOptions {
  const inputs: string[] = [];
  let outBin: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a: string = argv[i];
    if (a === "-o" || a === "--output") {
      const val: string | undefined = argv[++i];
      if (!val) throw new Error(`${a} requires a path`);
      outBin = val;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    }
    inputs.push(a);
  }
  if (inputs.length === 0) {
    throw new Error(
      "Usage: mn1613link <a.rel> [b.rel ...] [-o out.bin]",
    );
  }
  return { inputs, outBin };
}

/**
 * リンカ CLI エントリポイント。
 */
function main(): void {
  const opts: LinkCliOptions = parseArgs(process.argv.slice(2));
  const texts: string[] = opts.inputs.map((p) =>
    fs.readFileSync(path.resolve(p), "utf8"),
  );
  const result = linkRelTexts(texts);

  const outPath: string =
    opts.outBin ??
    path.join(
      path.dirname(path.resolve(opts.inputs[0])),
      `${path.basename(opts.inputs[0], path.extname(opts.inputs[0]))}.bin`,
    );
  fs.writeFileSync(outPath, result.image);
  console.log(`Wrote ${outPath} (${result.image.length} bytes)`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
