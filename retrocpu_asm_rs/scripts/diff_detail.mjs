#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { assemble: assembleTs } = require("../../retrocpu_asm_ts/dist/main/assembler.js");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RS_ROOT = path.resolve(__dirname, "..");

const file = process.argv[2];
const cpu = process.argv[3] ?? "mn1613";
const source = fs.readFileSync(file, "utf8");

const ts = assembleTs(source, cpu);
const rs = JSON.parse(
  execFileSync("cargo", ["run", "--quiet", "--bin", "asm_snapshot", "--", cpu], {
    cwd: RS_ROOT,
    input: source,
    encoding: "utf8",
  }).trim(),
);

let mism = 0;
const n = Math.max(ts.words.length, rs.words.length);
for (let i = 0; i < n; i += 1) {
  const a = ts.words[i];
  const b = rs.words[i];
  if (!a || !b || a.address !== b.address || a.value !== b.value) {
    if (mism < 20) {
      console.log(
        `#${i} TS=${a ? `${a.address.toString(16)}/${a.value.toString(16)}` : "-"} RS=${b ? `${b.address.toString(16)}/${b.value.toString(16)}` : "-"}`,
      );
    }
    mism += 1;
  }
}
console.log(`mismatches=${mism} ts.len=${ts.words.length} rs.len=${rs.words.length}`);
