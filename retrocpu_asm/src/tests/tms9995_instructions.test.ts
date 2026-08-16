/**
 * TMS9995 全命令エンコードテスト（sdas 構文）
 *
 * 根拠: .cursor/rules/TMS9995_instruction.mdc / asm_rules.mdc
 * 実行: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../main/assembler";
import { writeRel } from "../main/relWriter";
import { TMS9995_OPS } from "../main/tms9995/tms9995_encode";

function asmWords(src: string): number[] {
  return assemble(`        .org 0\n${src}\n`, "tms9995").words.map(
    (w) => w.value,
  );
}

function asm1(src: string): number {
  return asmWords(src)[0]!;
}

describe("TMS9995 Format 8", () => {
  test("LI R1, #0x1234 → 0201 1234", () => {
    assert.deepEqual(asmWords("        LI R1, #0x1234"), [0x0201, 0x1234]);
  });

  test("AI R0, #1", () => {
    assert.deepEqual(asmWords("        AI R0, #1"), [0x0220, 0x0001]);
  });

  test("CI R1, #0x0100", () => {
    assert.deepEqual(asmWords("        CI R1, #0x0100"), [0x0281, 0x0100]);
  });

  test("LWPI / LIMI", () => {
    assert.deepEqual(asmWords("        LWPI #0x8300"), [0x02e0, 0x8300]);
    assert.deepEqual(asmWords("        LIMI #2"), [0x0300, 0x0002]);
  });

  test("LST / LWP", () => {
    assert.equal(asm1("        LST R15"), 0x008f);
    assert.equal(asm1("        LWP R13"), 0x009d);
  });

  test("即値に # が無いとエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        LI R1, 0x1234\n", "tms9995"),
      /immediate requires '#'/,
    );
  });
});

describe("TMS9995 Format 1", () => {
  test("MOV R1, R2 → C081", () => {
    assert.equal(asm1("        MOV R1, R2"), 0xc081);
  });

  test("A R2, R1", () => {
    assert.equal(asm1("        A R2, R1"), 0xa042);
  });

  test("MOV (R3)+, R0 はオートインクリメント", () => {
    // src mode11 reg3, dst R0
    // C000 | (0<<10)|(0<<6)|(3<<4)|3 = C000 | 0x30 | 3 = C033
    assert.equal(asm1("        MOV (R3)+, R0"), 0xc033);
  });

  test("MOV LAB, R0 with byte address", () => {
    const r = assemble(
      ["        .org 0x1000", "LAB:    .word 0xABCD", "        MOV LAB, R0", ""].join(
        "\n",
      ),
      "tms9995",
    );
    const mov = r.words.filter((w) => w.address >= 0x1002);
    assert.equal(mov[0]!.value, 0xc020);
    assert.equal(mov[1]!.value, 0x1000);
    assert.equal(r.symbols.get("LAB"), 0x1000);
    assert.equal(r.addressUnit, "byte");
  });

  test("MOV TAB(R1), R0 はインデックス", () => {
    const r = assemble(
      ["        .org 0", "        MOV TAB(R1), R0", "TAB:    .word 0", ""].join(
        "\n",
      ),
      "tms9995",
    );
    // src mode10 reg1 extra=TAB(4), dst R0
    // C000 | 0 | (2<<4)|1 = C021, extra=4
    assert.equal(r.words[0]!.value, 0xc021);
    assert.equal(r.words[1]!.value, 4);
  });
});

describe("TMS9995 Format 6 / 7", () => {
  test("CLR R0 → 04C0", () => {
    assert.equal(asm1("        CLR R0"), 0x04c0);
  });

  test("B START", () => {
    const r = assemble(
      ["        .org 0x2000", "START:  B START", ""].join("\n"),
      "tms9995",
    );
    assert.equal(r.words[0]!.value, 0x0460);
    assert.equal(r.words[1]!.value, 0x2000);
  });

  test("RT → B (R11) = 045B", () => {
    assert.equal(asm1("        RT"), 0x045b);
    assert.equal(asm1("        B (R11)"), 0x045b);
  });

  test("RTWP → 0380", () => {
    assert.equal(asm1("        RTWP"), 0x0380);
  });

  test("BL SUB", () => {
    assert.deepEqual(asmWords("        BL 0x3000"), [0x06a0, 0x3000]);
  });

  test("TI 風 @ / *R は拒否", () => {
    assert.throws(
      () => assemble("        .org 0\n        B @START\n", "tms9995"),
      /TI syntax is not used/,
    );
    assert.throws(
      () => assemble("        .org 0\n        B *R11\n", "tms9995"),
      /TI syntax is not used/,
    );
  });
});

describe("TMS9995 Format 2 jumps", () => {
  test("JMP forward", () => {
    const r = assemble(
      ["        .org 0", "        JMP L", "        CLR R1", "L:      CLR R0", ""].join(
        "\n",
      ),
      "tms9995",
    );
    assert.equal(r.words[0]!.value, 0x1001);
  });

  test("JNE LOOP", () => {
    const r = assemble(
      ["        .org 0", "LOOP:   A R2, R1", "        JNE LOOP", ""].join("\n"),
      "tms9995",
    );
    assert.equal(r.words[1]!.address, 2);
    assert.equal(r.words[1]!.value, 0x1600 | 0xfe);
  });
});

describe("TMS9995 REL バイトアドレス", () => {
  test("T レコードがバイトアドレス", () => {
    const rel = writeRel(
      assemble("        .org 0x0100\n        LI R0, #0x0001\n", "tms9995"),
      "TMS9995",
    );
    assert.match(rel, /T 01 00 02 00 00 01/);
    assert.match(rel, /A _CODE size 0104/);
  });
});

/**
 * TMS9995_instruction.mdc の全ニーモニック（RT/NOP 含む）を 1 回ずつ。
 * Format 1 は src=R1 dst=R2。ジャンプは org 0 で次命令（disp=0）。
 */
const ALL_INSN: { src: string; words: number[] }[] = [
  { src: "SZC R1, R2", words: [0x4081] },
  { src: "SZCB R1, R2", words: [0x5081] },
  { src: "S R1, R2", words: [0x6081] },
  { src: "SB R1, R2", words: [0x7081] },
  { src: "C R1, R2", words: [0x8081] },
  { src: "CB R1, R2", words: [0x9081] },
  { src: "A R1, R2", words: [0xa081] },
  { src: "AB R1, R2", words: [0xb081] },
  { src: "MOV R1, R2", words: [0xc081] },
  { src: "MOVB R1, R2", words: [0xd081] },
  { src: "SOC R1, R2", words: [0xe081] },
  { src: "SOCB R1, R2", words: [0xf081] },
  { src: "JMP 2", words: [0x1000] },
  { src: "JLT 2", words: [0x1100] },
  { src: "JLE 2", words: [0x1200] },
  { src: "JEQ 2", words: [0x1300] },
  { src: "JHE 2", words: [0x1400] },
  { src: "JGT 2", words: [0x1500] },
  { src: "JNE 2", words: [0x1600] },
  { src: "JNC 2", words: [0x1700] },
  { src: "JOC 2", words: [0x1800] },
  { src: "JNO 2", words: [0x1900] },
  { src: "JL 2", words: [0x1a00] },
  { src: "JH 2", words: [0x1b00] },
  { src: "JOP 2", words: [0x1c00] },
  { src: "SBO #0", words: [0x1d00] },
  { src: "SBZ #1", words: [0x1e01] },
  { src: "TB #-1", words: [0x1fff] },
  { src: "COC R1, R2", words: [0x2081] },
  { src: "CZC R1, R2", words: [0x2481] },
  { src: "XOR R1, R2", words: [0x2881] },
  { src: "XOP R1, #3", words: [0x2cc1] },
  { src: "LDCR R1, #8", words: [0x3201] },
  { src: "STCR R1, #16", words: [0x3401] },
  { src: "MPY R1, R2", words: [0x3881] },
  { src: "DIV R1, R2", words: [0x3c81] },
  { src: "SRA R1, #0", words: [0x0801] },
  { src: "SRL R1, #1", words: [0x0911] },
  { src: "SLA R1, #2", words: [0x0a21] },
  { src: "SRC R1, #15", words: [0x0bf1] },
  { src: "DIVS R0", words: [0x0180] },
  { src: "MPYS R0", words: [0x01c0] },
  { src: "BLWP R0", words: [0x0400] },
  { src: "B R0", words: [0x0440] },
  { src: "X R0", words: [0x0480] },
  { src: "CLR R0", words: [0x04c0] },
  { src: "NEG R0", words: [0x0500] },
  { src: "INV R0", words: [0x0540] },
  { src: "INC R0", words: [0x0580] },
  { src: "INCT R0", words: [0x05c0] },
  { src: "DEC R0", words: [0x0600] },
  { src: "DECT R0", words: [0x0640] },
  { src: "BL R0", words: [0x0680] },
  { src: "SWPB R0", words: [0x06c0] },
  { src: "SETO R0", words: [0x0700] },
  { src: "ABS R0", words: [0x0740] },
  { src: "IDLE", words: [0x0340] },
  { src: "RSET", words: [0x0360] },
  { src: "RTWP", words: [0x0380] },
  { src: "CKON", words: [0x03a0] },
  { src: "CKOF", words: [0x03c0] },
  { src: "LREX", words: [0x03e0] },
  { src: "LI R1, #1", words: [0x0201, 0x0001] },
  { src: "AI R1, #1", words: [0x0221, 0x0001] },
  { src: "ANDI R1, #1", words: [0x0241, 0x0001] },
  { src: "ORI R1, #1", words: [0x0261, 0x0001] },
  { src: "CI R1, #1", words: [0x0281, 0x0001] },
  { src: "LWPI #0", words: [0x02e0, 0x0000] },
  { src: "LIMI #0", words: [0x0300, 0x0000] },
  { src: "STWP R1", words: [0x02a1] },
  { src: "STST R1", words: [0x02c1] },
  { src: "LST R1", words: [0x0081] },
  { src: "LWP R1", words: [0x0091] },
  { src: "RT", words: [0x045b] },
  { src: "NOP", words: [0x1000] },
];

describe("TMS9995 全命令セット", () => {
  for (const c of ALL_INSN) {
    test(c.src, () => {
      assert.deepEqual(asmWords(`        ${c.src}`), c.words);
    });
  }

  test("TMS9995_OPS とテスト表のニーモニックが一致する", () => {
    const fromCases = new Set(
      ALL_INSN.map((c) => c.src.trim().split(/\s+/)[0]!.toUpperCase()),
    );
    assert.deepEqual(
      [...fromCases].sort(),
      [...TMS9995_OPS].sort(),
    );
  });
});
