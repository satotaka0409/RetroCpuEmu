/**
 * TMS9995 第1弾命令エンコードテスト
 *
 * 根拠: .cursor/rules/TMS9995_instruction.mdc
 * 実行: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { assemble } from "../main/assembler";
import { writeRel } from "../main/relWriter";

function asmWords(src: string): number[] {
  return assemble(`        .org 0\n${src}\n`, "tms9995").words.map(
    (w) => w.value,
  );
}

function asm1(src: string): number {
  return asmWords(src)[0]!;
}

describe("TMS9995 Format 8", () => {
  test("LI R1, >1234 → 0201 1234", () => {
    assert.deepEqual(asmWords("        LI R1, >1234"), [0x0201, 0x1234]);
  });

  test("AI R0, 1", () => {
    assert.deepEqual(asmWords("        AI R0, 1"), [0x0220, 0x0001]);
  });

  test("CI R1, >0100", () => {
    assert.deepEqual(asmWords("        CI R1, >0100"), [0x0281, 0x0100]);
  });

  test("LWPI / LIMI", () => {
    assert.deepEqual(asmWords("        LWPI >8300"), [0x02e0, 0x8300]);
    assert.deepEqual(asmWords("        LIMI 2"), [0x0300, 0x0002]);
  });

  test("LST / LWP", () => {
    assert.equal(asm1("        LST R15"), 0x008f);
    assert.equal(asm1("        LWP R13"), 0x009d);
  });
});

describe("TMS9995 Format 1", () => {
  test("MOV R1, R2 → C081", () => {
    // src=R1 mode00 reg1, dst=R2 mode00 reg2
    // C000 | (0<<10)|(2<<6)|(0<<4)|1 = C000 | 0x80 | 1 = C081
    assert.equal(asm1("        MOV R1, R2"), 0xc081);
  });

  test("A R2, R1", () => {
    // src R2, dst R1 → A000 | (0<<10)|(1<<6)|(0<<4)|2 = A000|0x40|2 = A042
    assert.equal(asm1("        A R2, R1"), 0xa042);
  });

  test("MOV @LABEL, R0 with byte address", () => {
    const r = assemble(
      ["        .org >1000", "LAB:    .word >ABCD", "        MOV @LAB, R0", ""].join(
        "\n",
      ),
      "tms9995",
    );
    // LAB at >1000, MOV at >1002
    // MOV @LAB, R0: src=@ mode10 reg0 + extra, dst=R0
    // C000 | (0<<10)|(0<<6)|(2<<4)|0 = C000 | 0x20 = C020, then 1000
    const mov = r.words.filter((w) => w.address >= 0x1002);
    assert.equal(mov[0]!.value, 0xc020);
    assert.equal(mov[1]!.value, 0x1000);
    assert.equal(r.symbols.get("LAB"), 0x1000);
    assert.equal(r.addressUnit, "byte");
  });
});

describe("TMS9995 Format 6 / 7", () => {
  test("CLR R0 → 04C0", () => {
    assert.equal(asm1("        CLR R0"), 0x04c0);
  });

  test("B @START", () => {
    const r = assemble(
      ["        .org >2000", "START:  B @START", ""].join("\n"),
      "tms9995",
    );
    // B @ : 0440 | mode10<<4 | reg0 = 0440 | 0x20 = 0460, extra=2000
    assert.equal(r.words[0]!.value, 0x0460);
    assert.equal(r.words[1]!.value, 0x2000);
  });

  test("RT → B *R11 = 045B", () => {
    assert.equal(asm1("        RT"), 0x045b);
  });

  test("RTWP → 0380", () => {
    assert.equal(asm1("        RTWP"), 0x0380);
  });

  test("BL @SUB", () => {
    assert.deepEqual(asmWords("        BL @>3000"), [0x06a0, 0x3000]);
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
    // JMP at 0, next=2, L at 4 (CLR R1 is 1 word), disp=(4-2)/2=1
    assert.equal(r.words[0]!.value, 0x1001);
  });

  test("JNE LOOP", () => {
    const r = assemble(
      ["        .org 0", "LOOP:   A R2, R1", "        JNE LOOP", ""].join("\n"),
      "tms9995",
    );
    // LOOP at 0, A at 0, JNE at 2, next=4, target=0 → disp=-2 = 0xFE
    assert.equal(r.words[1]!.address, 2);
    assert.equal(r.words[1]!.value, 0x1600 | 0xfe);
  });
});

describe("TMS9995 REL バイトアドレス", () => {
  test("T レコードがバイトアドレス", () => {
    const rel = writeRel(
      assemble("        .org >0100\n        LI R0, >0001\n", "tms9995"),
      "TMS9995",
    );
    assert.match(rel, /T 0100 04 02 00 00 01/);
    assert.match(rel, /A _CODE size 0104/);
  });
});

describe("TMS9995 未対応命令", () => {
  test("MPY は第1弾でエラー", () => {
    assert.throws(
      () => assemble("        .org 0\n        MPY R1, R2\n", "tms9995"),
      /unsupported TMS9995 opcode/,
    );
  });
});
