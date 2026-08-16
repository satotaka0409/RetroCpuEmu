#!/usr/bin/env node
/**
 * モニタ CDB から BIOS ラベルのワードアドレスを .equ にする。
 * 使い方: node gen_bios_addrs.mjs mn1613_mon.cdb > bios_addrs.inc
 */
import fs from "node:fs";

const names = ["g_bios_beep", "g_hshk_get_time"];
const cdbPath = process.argv[2];
if (!cdbPath) {
  process.stderr.write("usage: gen_bios_addrs.mjs <mn1613_mon.cdb>\n");
  process.exit(1);
}
const cdb = fs.readFileSync(cdbPath, "utf8");
process.stdout.write("; generated from mn1613_mon.cdb — do not edit\n");
for (const n of names) {
  const re = new RegExp(`L:G\\$${n}\\$0\\$0:([0-9A-Fa-f]+)`, "i");
  const m = cdb.match(re);
  if (!m) {
    process.stderr.write(`CDB に ${n} がありません: ${cdbPath}\n`);
    process.exit(1);
  }
  const word = parseInt(m[1], 16) >>> 1;
  const hex = word.toString(16).toUpperCase().padStart(4, "0");
  process.stdout.write(`${n}\t.equ\t0x${hex}\n`);
}
