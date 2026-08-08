#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { linkRelTexts, orderRelPathsMainFirst } from "./linker";

/**
 * リンカ CLI オプション
 */
export interface LinkCliOptions {
  inputs: string[];
  outBin?: string;
  /** CDB 出力パス。省略時は .bin と同じ stem の .cdb */
  outCdb?: string;
}

/**
 * 引数を解析する。
 * @param argv - process.argv.slice(2)
 * @return オプション
 */
/**
 * リンカ Def（バイトアドレス）を SDCC CDB の L:G にする。
 * @param defs シンボル → バイトアドレス
 * @returns CDB テキスト
 */
export function defsToCdbText(defs: Map<string, number>): string {
  const names: string[] = [...defs.keys()].sort((a, b) => a.localeCompare(b));
  const lines: string[] = [];
  for (const name of names) {
    const hex: string = (defs.get(name)! >>> 0).toString(16).toUpperCase();
    lines.push(`L:G$${name}$0$0:${hex}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseLinkArgs(argv: string[]): LinkCliOptions {
  const inputs: string[] = [];
  let outBin: string | undefined;
  let outCdb: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a: string = argv[i]!;
    if (a === "-o" || a === "--output") {
      const val: string | undefined = argv[++i];
      if (!val) throw new Error(`${a} requires a path`);
      outBin = val;
      continue;
    }
    if (a === "--cdb") {
      const val: string | undefined = argv[++i];
      if (!val) throw new Error(`${a} requires a path`);
      outCdb = val;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    }
    inputs.push(a);
  }
  if (inputs.length === 0) {
    throw new Error(
      "Usage: mn1613link <a.rel> [b.rel ...] [-o out.bin] [--cdb out.cdb]\n" +
        "main.rel is required and is always linked first",
    );
  }
  return { inputs, outBin, outCdb };
}

/**
 * リンカ CLI エントリポイント。
 */
function main(): void {
  const opts: LinkCliOptions = parseLinkArgs(process.argv.slice(2));
  const ordered: string[] = orderRelPathsMainFirst(opts.inputs);
  const texts: string[] = ordered.map((p) =>
    fs.readFileSync(path.resolve(p), "utf8"),
  );
  const result = linkRelTexts(texts);

  const outPath: string =
    opts.outBin ??
    path.join(
      path.dirname(path.resolve(ordered[0]!)),
      `${path.basename(ordered[0]!, path.extname(ordered[0]!))}.bin`,
    );
  fs.writeFileSync(outPath, result.image);
  console.log(`Wrote ${outPath} (${result.image.length} bytes)`);

  const cdbPath: string =
    opts.outCdb ??
    path.join(
      path.dirname(outPath),
      `${path.basename(outPath, path.extname(outPath))}.cdb`,
    );
  fs.writeFileSync(cdbPath, defsToCdbText(result.defs));
  console.log(`Wrote ${cdbPath} (${result.defs.size} symbols)`);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
