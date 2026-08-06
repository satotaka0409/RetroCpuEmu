#!/usr/bin/env node
/**
 * retrocpu_asm の REL を sdld (asxxxx) が読める形式へ変換する。
 *
 * 相違点:
 * - T: `T aaaa nn dd...` → `T aa aa dd...`（長さ無し、アドレスはバイト列）
 * - 各 T の直後に空の `R 00 00 00 00`
 * - S を A の直後・T の前へ
 * - `S .__.ABS. Def0000` を追加し H の global 数を合わせる
 * - A 行に `addr 0` を付与（size は 16 進）
 *
 * 注意: sdld (XH2) は T 行の評価値が NTXT(=16) 超だと無限ループするため、
 * アドレス2バイト＋データは最大14バイトに分割する。
 *
 * Usage: node rel_to_asxxxx.js <in.rel> -o <out.rel>
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** XH2: アドレス2バイト + データ最大14バイト */
const MAX_T_DATA_BYTES = 14;

function usage() {
  console.error("Usage: rel_to_asxxxx.js <in.rel> -o <out.rel>");
  process.exit(2);
}

function hex2(v) {
  return (v & 0xff).toString(16).toUpperCase().padStart(2, "0");
}

function hex4(v) {
  return (v & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

function convert(relText) {
  const lines = relText.split(/\r?\n/);
  let moduleName = "mod";
  /** @type {Array<{name: string, size: number}>} */
  const areas = [];
  /** @type {Array<{name: string, def: boolean, value: number}>} */
  const syms = [];
  /** @type {Array<{addr: number, data: string[]}>} */
  const texts = [];

  for (const line of lines) {
    if (!line || line.startsWith("XH") || line.startsWith("H ")) continue;
    if (line.startsWith("M ")) {
      moduleName = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("A ")) {
      const parts = line.split(/\s+/);
      const size = parseInt(parts[3], 16);
      areas.push({ name: parts[1], size });
      continue;
    }
    if (line.startsWith("S ")) {
      const parts = line.split(/\s+/);
      const name = parts[1];
      const kind = parts[2] || "";
      if (kind.startsWith("Def")) {
        syms.push({ name, def: true, value: parseInt(kind.slice(3), 16) });
      } else if (kind.startsWith("Ref")) {
        syms.push({ name, def: false, value: 0 });
      }
      continue;
    }
    if (line.startsWith("T ")) {
      const parts = line.split(/\s+/);
      const addr = parseInt(parts[1], 16);
      const data = parts.slice(3); // skip length
      texts.push({ addr, data });
      continue;
    }
    if (line.startsWith("W ") || line.startsWith("E")) continue;
  }

  const out = [];
  out.push("XH2");
  out.push(`H ${areas.length} areas ${syms.length + 1} global symbols`);
  out.push(`M ${moduleName}`);
  out.push("S .__.ABS. Def0000");
  for (const a of areas) {
    out.push(`A ${a.name} size ${a.size.toString(16).toUpperCase()} flags 0 addr 0`);
  }
  for (const s of syms) {
    if (s.def) {
      out.push(`S ${s.name} Def${hex4(s.value)}`);
    } else {
      out.push(`S ${s.name} Ref0000`);
    }
  }
  for (const t of texts) {
    for (let i = 0; i < t.data.length; i += MAX_T_DATA_BYTES) {
      const chunk = t.data.slice(i, i + MAX_T_DATA_BYTES);
      const addr = t.addr + i;
      const ab = hex4(addr);
      out.push(`T ${ab.slice(0, 2)} ${ab.slice(2, 4)} ${chunk.join(" ")}`);
      out.push("R 00 00 00 00");
    }
  }
  out.push("E");
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

  const text = fs.readFileSync(path.resolve(inPath), "utf8");
  const converted = convert(text);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), converted);
  console.log(`Wrote ${outPath}`);
}

main(process.argv.slice(2));
