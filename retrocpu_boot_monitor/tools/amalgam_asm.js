#!/usr/bin/env node
/**
 * アセンブラソースを .include 展開して 1 ファイルに結合する。
 * 同一パスの include は一度だけ展開する（.equ 二重定義回避）。
 *
 * Usage: node amalgam_asm.js <entry.asm> -o <out.asm>
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.error("Usage: amalgam_asm.js <entry.asm> -o <out.asm>");
  process.exit(2);
}

/**
 * @param {string} absPath
 * @param {Set<string>} seen
 * @param {string[]} stack
 * @returns {string}
 */
function expand(absPath, seen, stack) {
  const norm = path.resolve(absPath);
  if (stack.includes(norm)) {
    throw new Error(`Include cycle: ${[...stack, norm].join(" -> ")}`);
  }
  if (seen.has(norm)) {
    return `; [skip already included] ${path.basename(norm)}\n`;
  }
  seen.add(norm);

  if (!fs.existsSync(norm)) {
    throw new Error(`File not found: ${norm}`);
  }

  const text = fs.readFileSync(norm, "utf8");
  const lines = text.split(/\r?\n/);
  const out = [];
  out.push(`; -------- begin ${path.relative(process.cwd(), norm) || norm}`);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^(?:\.INCLUDE|INCLUDE)\s+(.+)$/i);
    if (!m) {
      out.push(line);
      continue;
    }
    let operand = m[1].trim();
    // strip quotes / comments
    const q = operand.match(/^"([^"]+)"/) || operand.match(/^'([^']+)'/);
    if (q) operand = q[1];
    else operand = operand.replace(/\s*;.*$/, "").trim();

    const includeFile = path.isAbsolute(operand)
      ? operand
      : path.resolve(path.dirname(norm), operand);
    out.push(`; .include ${operand}`);
    out.push(expand(includeFile, seen, [...stack, norm]));
  }

  out.push(`; -------- end ${path.basename(norm)}`);
  return out.join("\n") + "\n";
}

function main(argv) {
  let inPath;
  let outPath;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-o") {
      outPath = argv[++i];
      continue;
    }
    if (a.startsWith("-")) usage();
    if (!inPath) inPath = a;
    else usage();
  }
  if (!inPath || !outPath) usage();

  const absIn = path.resolve(inPath);
  const body = expand(absIn, new Set(), []);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), body);
  console.log(`Wrote ${outPath}`);
}

main(process.argv.slice(2));
