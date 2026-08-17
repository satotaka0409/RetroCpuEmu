#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fatalCliError } from "./cli";
import { linkRelsWithSdld } from "./sdldLink";

/**
 * sdld ラッパの引数。
 */
interface SdldLinkCliOptions {
  rels: string[];
  outIhx: string;
  outCdb?: string;
  outMap?: string;
}

const USAGE =
  "Usage: sdld-link <a.rel> [b.rel ...] -o out.ihx [--cdb out.cdb] [--map out.map]";

/**
 * CLI 引数を解析する。
 * @param argv 引数
 * @returns オプション
 */
export function parseSdldLinkArgs(argv: string[]): SdldLinkCliOptions {
  const rels: string[] = [];
  let outIhx = "";
  let outCdb: string | undefined;
  let outMap: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "-o") {
      outIhx = argv[++i] ?? "";
      continue;
    }
    if (a === "--cdb") {
      outCdb = argv[++i];
      continue;
    }
    if (a === "--map") {
      outMap = argv[++i];
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`${USAGE}\nUnknown option: ${a}`);
    }
    rels.push(a);
  }
  if (rels.length === 0 || !outIhx) {
    throw new Error(USAGE);
  }
  return { rels, outIhx, outCdb, outMap };
}

/**
 * .rel を sdld でリンクして IHX / CDB / MAP を書く。
 * @param argv CLI 引数
 */
export function main(argv: string[] = process.argv.slice(2)): void {
  const opts = parseSdldLinkArgs(argv);
  for (const rel of opts.rels) {
    if (!fs.existsSync(rel)) {
      throw new Error(`Input file not found: ${rel}`);
    }
  }
  const result = linkRelsWithSdld(opts.rels);
  const ihxPath = path.resolve(opts.outIhx);
  fs.mkdirSync(path.dirname(ihxPath), { recursive: true });
  fs.writeFileSync(ihxPath, result.hexText, "utf8");
  process.stdout.write(`Wrote ${ihxPath}\n`);
  if (opts.outCdb) {
    const cdbPath = path.resolve(opts.outCdb);
    fs.mkdirSync(path.dirname(cdbPath), { recursive: true });
    fs.writeFileSync(cdbPath, result.cdbText, "utf8");
    process.stdout.write(`Wrote ${cdbPath}\n`);
  }
  if (opts.outMap) {
    const mapPath = path.resolve(opts.outMap);
    fs.mkdirSync(path.dirname(mapPath), { recursive: true });
    fs.writeFileSync(mapPath, result.mapText, "utf8");
    process.stdout.write(`Wrote ${mapPath}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    fatalCliError(e);
  }
}
