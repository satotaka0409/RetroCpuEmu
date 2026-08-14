/**
 * セッション起動時の M系列メモリ埋め
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleToHexCdb } from "../src/assemble_link.js";
import {
  fillMemoryMSequence,
  memMseqSeedFromTime,
  mseqStep,
} from "../src/m_sequence.js";
import { createMn1613AsmSession } from "../src/mn1613_session.js";
import { expect, test } from "../src/unit.js";

/**
 * 種から n+1 歩進めた値（物理ワード n に書かれる値）。
 * @param seed 開始種（16bit）
 * @param wordIndex 物理ワードアドレス
 * @returns 16bit
 */
function mseqAt(seed: number, wordIndex: number): number {
  let x = seed;
  for (let i = 0; i <= wordIndex; i += 1) {
    x = mseqStep(x);
  }
  return x;
}

test("memMseqSeedFromTime は 0 以外の 16bit を返す", () => {
  for (let i = 0; i < 8; i += 1) {
    const s = memMseqSeedFromTime();
    expect(s).toBe(s & 0xffff);
    expect(s).toBeGreaterThanOrEqual(1);
  }
});

test("fillMemoryMSequence は指定種から Galois LFSR を書く", () => {
  const seed = 1;
  const buf = new ArrayBuffer(16);
  expect(fillMemoryMSequence(buf, seed)).toBe(1);
  const view = new DataView(buf);
  let x = seed;
  for (let i = 0; i < 8; i += 1) {
    x = mseqStep(x);
    expect(view.getUint16(i * 2, false)).toBe(x);
  }
});

test("fillMemoryMSequence の種 1 の先頭ワードは 0xB400", () => {
  const buf = new ArrayBuffer(2);
  fillMemoryMSequence(buf, 1);
  expect(new DataView(buf).getUint16(0, false)).toBe(0xb400);
});

test("fillMemoryMSequence は種省略時に時刻種で埋め、戻り種と一致する", () => {
  const buf = new ArrayBuffer(4);
  const seed = fillMemoryMSequence(buf);
  const view = new DataView(buf);
  expect(view.getUint16(0, false)).toBe(mseqStep(seed));
  expect(view.getUint16(2, false)).toBe(mseqStep(mseqStep(seed)));
});

test("reload 後、HEX の外は時刻種の M系列のまま", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-mseq-"));
  const hexFile = path.join(dir, "t.ihx");
  const cdbFile = path.join(dir, "t.cdb");
  assembleToHexCdb({
    sources: [
      {
        module: "MAIN",
        text: [
          "\t.cpu\tmn1613",
          "\t.area\t_CODE (REL,CON)",
          "\t.org\t0x0200",
          "\t.globl\tgl_main",
          "gl_main:",
          "\th",
          "",
        ].join("\n"),
      },
    ],
    hexFile,
    cdbFile,
  });
  const session = createMn1613AsmSession({
    initLabel: "gl_main",
    hexFile,
    cdbFile,
  });
  const unused = 0x3000;
  expect(session.readWord(unused)).toBe(mseqAt(session.memoryMseqSeed, unused));
});
