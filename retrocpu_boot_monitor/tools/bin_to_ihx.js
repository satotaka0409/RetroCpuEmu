#!/usr/bin/env node
/**
 * リンカが出したバイナリイメージを Intel HEX に変換する。
 * @param argv process.argv（in.bin [out.ihx]）
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * 1 レコードのチェックサムバイトを求める。
 * @param bytes レコード本体（長さ・アドレス・種別・データ）
 * @returns 2 の補数チェックサム（0–255）
 */
function checksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) & 0xff;
  return (~sum + 1) & 0xff;
}

/**
 * バイト配列を Intel HEX 文字列にする。
 * @param buf イメージ
 * @returns IHX テキスト（終了レコード付き）
 */
function binToIhx(buf) {
  const lines = [];
  for (let addr = 0; addr < buf.length; addr += 16) {
    const chunk = buf.subarray(addr, Math.min(addr + 16, buf.length));
    const rec = [chunk.length, (addr >> 8) & 0xff, addr & 0xff, 0, ...chunk];
    rec.push(checksum(rec));
    lines.push(
      `:${rec.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")}`,
    );
  }
  lines.push(":00000001FF");
  return `${lines.join("\n")}\n`;
}

/**
 * CLI エントリ。
 */
function main() {
  const inPath = process.argv[2];
  if (!inPath) {
    console.error("Usage: bin_to_ihx.js <in.bin> [out.ihx]");
    process.exit(1);
  }
  const outPath =
    process.argv[3] ??
    path.join(
      path.dirname(path.resolve(inPath)),
      `${path.basename(inPath, path.extname(inPath))}.ihx`,
    );
  const buf = fs.readFileSync(inPath);
  fs.writeFileSync(outPath, binToIhx(buf), "utf8");
  console.log(`Wrote ${outPath} (${buf.length} bytes)`);
}

main();
