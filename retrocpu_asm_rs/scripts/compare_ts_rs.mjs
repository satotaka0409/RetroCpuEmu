#!/usr/bin/env node
/**
 * TS 版 retrocpu_asm と RS 版 retrocpu_asm_rs のアセンブル結果を比較する。
 *
 * Usage:
 *   node scripts/compare_ts_rs.mjs [fixture.asm ...]
 *   node scripts/compare_ts_rs.mjs --tms9995
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { assemble: assembleTs } = require("../../retrocpu_asm_ts/dist/main/assembler.js");
const { writeLst: writeLstTs } = require("../../retrocpu_asm_ts/dist/main/lstWriter.js");
const { writeRel: writeRelTs } = require("../../retrocpu_asm_ts/dist/main/relWriter.js");
const { TMS9995_ALL_INSN } = await import("./tms9995_all_insn.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RS_ROOT = path.resolve(__dirname, "..");
const TS_ROOT = path.resolve(RS_ROOT, "..", "retrocpu_asm_ts");

/** @typedef {{ address: number, value: number }} Word */
/** @typedef {{ cpu: string, address_unit: string, words: Word[], symbols: [string, number][], lst?: string, rel_baseline?: string, error?: string|null }} Snapshot */

/**
 * TS 版でアセンブルして正規化スナップショットを返す。
 * @param {string} source
 * @param {"mn1613"|"tms9995"} cpu
 * @returns {Snapshot}
 */
function snapshotTs(source, cpu) {
  try {
    const r = assembleTs(source, cpu);
    const symbols = [...r.symbols.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    return {
      cpu,
      address_unit: r.addressUnit,
      words: r.words.map((w) => ({ address: w.address, value: w.value })),
      symbols,
      error: null,
    };
  } catch (e) {
    return {
      cpu,
      address_unit: "",
      words: [],
      symbols: [],
      error: String(e?.message ?? e),
    };
  }
}
function snapshotTsFull(source, cpu) {
  const snap = snapshotTs(source, cpu);
  if (snap.error) return snap;
  try {
    const r = assembleTs(source, cpu);
    snap.lst = writeLstTs(r);
    snap.rel_baseline = writeRelTs(r, "MOD");
  } catch (e) {
    snap.error = String(e?.message ?? e);
  }
  return snap;
}

/**
 * RS 版 asm_snapshot バイナリでアセンブルする。
 * @param {string} source
 * @param {"mn1613"|"tms9995"} cpu
 * @returns {Snapshot}
 */
function snapshotRs(source, cpu) {
  const out = execFileSync(
    "cargo",
    ["run", "--quiet", "--bin", "asm_snapshot", "--", cpu],
    {
      cwd: RS_ROOT,
      input: source,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return JSON.parse(out.trim());
}

/**
 * 2 スナップショットの差分を返す。一致なら null。
 * @param {Snapshot} ts
 * @param {Snapshot} rs
 * @param {string} label
 * @returns {string|null}
 */
function normError(err) {
  return err == null ? null : String(err);
}

function diffSnapshots(ts, rs, label) {
  const lines = [];
  const tsErr = normError(ts.error);
  const rsErr = normError(rs.error);
  if (tsErr !== rsErr) {
    lines.push(`error: TS=${tsErr ?? "ok"} RS=${rsErr ?? "ok"}`);
  }
  if (tsErr || rsErr) {
    return lines.length ? `${label}:\n  ${lines.join("\n  ")}` : null;
  }
  if (ts.address_unit !== rs.address_unit) {
    lines.push(`address_unit: TS=${ts.address_unit} RS=${rs.address_unit}`);
  }
  if (ts.words.length !== rs.words.length) {
    lines.push(`words.len: TS=${ts.words.length} RS=${rs.words.length}`);
  } else {
    for (let i = 0; i < ts.words.length; i += 1) {
      const a = ts.words[i];
      const b = rs.words[i];
      if (a.address !== b.address || a.value !== b.value) {
        lines.push(
          `words[${i}]: TS=${a.address.toString(16)}/${a.value.toString(16)} RS=${b.address.toString(16)}/${b.value.toString(16)}`,
        );
        if (lines.length > 8) break;
      }
    }
  }
  const tsSym = JSON.stringify(ts.symbols);
  const rsSym = JSON.stringify(rs.symbols);
  if (tsSym !== rsSym) {
    const note =
      ts.cpu === "tms9995"
        ? "symbols differ"
        : "symbols differ (MN1613 REL uses byte addrs for S/W)";
    lines.push(note);
  }
  return lines.length ? `${label}:\n  ${lines.join("\n  ")}` : null;
}

/**
 * TMS9995: LST のアドレス列が words と一致し、バイトアドレスであることを確認。
 * @param {Snapshot} ts
 * @param {Snapshot} rs
 * @param {string} label
 * @returns {string|null}
 */
function diffTms9995Lst(ts, rs, label) {
  if (!ts.lst || !rs.lst) return null;
  if (ts.lst !== rs.lst) {
    return `${label}: LST text differs`;
  }
  for (const w of ts.words) {
    if (w.address % 2 !== 0) {
      return `${label}: word address ${w.address.toString(16)} is not even (byte addr?)`;
    }
  }
  return null;
}

/**
 * TMS9995: RS REL ベースラインの W/S アドレスが words/symbols と同じバイト値か。
 * @param {Snapshot} rs
 * @param {string} label
 * @returns {string|null}
 */
function checkTms9995RelBaseline(rs, label) {
  if (!rs.rel_baseline) return null;
  for (const w of rs.words) {
    const expect = `W ${w.address.toString(16).toUpperCase().padStart(4, "0")} `;
    if (!rs.rel_baseline.includes(expect)) {
      return `${label}: REL baseline missing ${expect.trim()}`;
    }
  }
  for (const [name, val] of rs.symbols) {
    const expect = `S ${name} ${val.toString(16).toUpperCase().padStart(4, "0")}`;
    if (!rs.rel_baseline.includes(expect)) {
      return `${label}: REL baseline missing symbol ${name}=${val.toString(16)}`;
    }
  }
  return null;
}

/**
 * 1 ケースを比較する。
 * @param {string} label
 * @param {string} source
 * @param {"mn1613"|"tms9995"} cpu
 * @returns {string|null}
 */
function compareCase(label, source, cpu, opts = {}) {
  const ts = opts.full ? snapshotTsFull(source, cpu) : snapshotTs(source, cpu);
  const rs = snapshotRs(source, cpu);
  const d = diffSnapshots(ts, rs, label);
  if (d) return d;
  if (cpu === "tms9995") {
    if (ts.address_unit !== "byte" || rs.address_unit !== "byte") {
      return `${label}: address_unit must be byte (TS=${ts.address_unit} RS=${rs.address_unit})`;
    }
    if (opts.full) {
      const lstDiff = diffTms9995Lst(ts, rs, label);
      if (lstDiff) return lstDiff;
      const relDiff = checkTms9995RelBaseline(rs, label);
      if (relDiff) return relDiff;
    }
  }
  return null;
}

function runTms9995Suite(failures) {
  console.log("=== TMS9995 TS vs RS ===");
  for (const c of TMS9995_INLINE) {
    const d = compareCase(c.label, c.source, "tms9995", { full: c.full });
    if (d) failures.push(d);
    else console.log(`OK  ${c.label}`);
  }
  for (const c of TMS9995_ALL_INSN) {
    const src = `        .org 0\n        ${c.src}\n`;
    const label = `ALL_INSN: ${c.src}`;
    const d = compareCase(label, src, "tms9995");
    if (d) failures.push(d);
  }
  const insnFails = failures.length;
  if (insnFails === 0) {
    console.log(`OK  ALL_INSN (${TMS9995_ALL_INSN.length} mnemonics)`);
  }
  for (const c of TMS9995_FILE_CASES) {
    const source = fs.readFileSync(c.file, "utf8");
    const d = compareCase(c.label, source, "tms9995", { full: true });
    if (d) failures.push(d);
    else console.log(`OK  ${c.label}`);
  }
}

/** TMS9995 専用インラインケース（バイトアドレス統一） */
const TMS9995_INLINE = [
  {
    label: "tms9995: LI/AI + LST",
    full: true,
    source: "        .org 0\n        LI R1, #0x1234\n        AI R0, #1\n",
  },
  {
    label: "tms9995: MOV/RT/NOP",
    full: false,
    source:
      "        .org 0\n        MOV R1, R2\n        RT\n        NOP\n        RTWP\n",
  },
  {
    label: "tms9995: symbolic MOV",
    full: true,
    source:
      "        .org 0x1000\nLAB:    .word 0xABCD\n        MOV LAB, R0\n",
  },
  {
    label: "tms9995: .word label ref (byte addr)",
    full: true,
    source:
      "        .org 0x1000\nDATA:   .word 0x1234\n        .word DATA\n",
  },
];

const TMS9995_FILE_CASES = [
  {
    label: "sample/tms9995_all_instructions.asm",
    file: path.join(TS_ROOT, "sample", "tms9995_all_instructions.asm"),
  },
];

/** 内蔵スモークケース（MN1613） */
const INLINE_CASES = [
  {
    label: "mn1613: .equ/.word",
    cpu: "mn1613",
    source:
      "        .cpu mn1613\nMAIN: .equ 0x10\nLBL: .word 1, 'A'\n",
  },
  {
    label: "mn1613: H (HALT)",
    cpu: "mn1613",
    source: "        .cpu mn1613\n        .org 0\n        H\n",
  },
  {
    label: "mn1613: .word backward label ref",
    cpu: "mn1613",
    source:
      "        .cpu mn1613\n        .org 0\n        .word 0,0,0,0,0,0\nRELDATA: .word 0x1234\nRELPTR:  .word RELDATA\n",
  },
];

/** @deprecated use TMS9995_FILE_CASES */
const FILE_CASES = TMS9995_FILE_CASES;

function ensureRsBinary() {
  execFileSync("cargo", ["build", "--quiet", "--bin", "asm_snapshot"], {
    cwd: RS_ROOT,
    stdio: "inherit",
  });
}

function main() {
  ensureRsBinary();

  const args = process.argv.slice(2);
  const tmsOnly = args.includes("--tms9995");
  const useSuite = args.length === 0 || args.includes("--suite") || tmsOnly;
  const fileArgs = args.filter((a) => a !== "--suite" && a !== "--tms9995");

  /** @type {string[]} */
  const failures = [];

  if (tmsOnly) {
    runTms9995Suite(failures);
  } else if (useSuite) {
    for (const c of INLINE_CASES) {
      const d = compareCase(c.label, c.source, c.cpu);
      if (d) failures.push(d);
      else console.log(`OK  ${c.label}`);
    }
    for (const c of FILE_CASES) {
      const source = fs.readFileSync(c.file, "utf8");
      const d = compareCase(c.label, source, "tms9995", { full: true });
      if (d) failures.push(d);
      else console.log(`OK  ${c.label}`);
    }
  }

  for (const f of fileArgs) {
    const abs = path.resolve(f);
    const source = fs.readFileSync(abs, "utf8");
    const cpu = source.match(/\.cpu\s+(mn1613|tms9995)/i)?.[1]?.toLowerCase();
    if (cpu !== "mn1613" && cpu !== "tms9995") {
      console.error(`Skip ${f}: .cpu mn1613|tms9995 not found`);
      continue;
    }
    const d = compareCase(abs, source, cpu);
    if (d) failures.push(d);
    else console.log(`OK  ${abs}`);
  }

  if (failures.length) {
    console.error("\n=== DIFF ===");
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  const total =
    (tmsOnly
      ? TMS9995_INLINE.length + TMS9995_ALL_INSN.length + TMS9995_FILE_CASES.length
      : INLINE_CASES.length + FILE_CASES.length) + fileArgs.length;
  console.log(`\nAll ${total} case(s) matched.`);
}

main();
