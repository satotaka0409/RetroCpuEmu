/**
 * TMS9995 コードテスト・ハーネス試験
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bytesToIntelHex,
  createTms9995CodeTest,
  parseTms9995Cdb,
  tmsReadWord,
} from "../../src/code_test";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/tms9995",
);

/** A R2,R3 + B R11（Format6 register 直接、0x044B） */
const ADD_PROGRAM_WORDS = [0xa083, 0x044b];

describe("Tms9995CodeTest", () => {
  it("R2=R2+R3 を呼び出し R2 を検証する", async () => {
    const hex = bytesToIntelHex(0x8000, ADD_PROGRAM_WORDS);
    const cdb = "L:G$add$0$0:8000\n";

    const t = createTms9995CodeTest({ maxCycles: 10_000 });
    t.loadIntelHex(hex);
    t.loadCdb(cdb);

    await t.call("add", { registers: { R2: 3, R3: 4 } });
    t.expectRegisters({ R2: 7, R3: 4 });
  });

  it("大きい値でも add が動く", async () => {
    const hex = bytesToIntelHex(0x8000, ADD_PROGRAM_WORDS);
    const cdb = "L:G$add$0$0:8000\n";
    const t = createTms9995CodeTest();
    t.loadIntelHex(hex);
    t.loadCdb(cdb);
    await t.call("add", { registers: { R2: 10, R3: 32 } });
    t.expectRegisters({ R2: 42, R3: 32 });
  });

  it("parseTms9995Cdb は奇数バイトアドレスを受け付ける", () => {
    const table = parseTms9995Cdb("L:G$ODD$0$0:8001\n");
    expect(table.byName.get("ODD")?.byteAddr).toBe(0x8001);
  });

  it("fixtures/add.asm をアセンブル済み HEX があれば add を実行する", async () => {
    const hexPath = path.join(fixturesDir, "add.ihx");
    const cdbPath = path.join(fixturesDir, "add.cdb");
    if (!fs.existsSync(hexPath) || !fs.existsSync(cdbPath)) {
      const hex = bytesToIntelHex(0x8000, ADD_PROGRAM_WORDS);
      const cdb = "L:G$add$0$0:8000\n";
      const t = createTms9995CodeTest();
      t.loadIntelHex(hex);
      t.loadCdb(cdb);
      await t.call("add", { registers: { R2: 10, R3: 32 } });
      t.expectRegisters({ R2: 42, R3: 32 });
      return;
    }
    const hex = fs.readFileSync(hexPath, "utf8");
    const cdb = fs.readFileSync(cdbPath, "utf8");
    const t = createTms9995CodeTest();
    t.loadIntelHex(hex);
    t.loadCdb(cdb);
    await t.call("add", { registers: { R2: 10, R3: 32 } });
    t.expectRegisters({ R2: 42, R3: 32 });
  });
});

describe("Tms9995CodeTest memory", () => {
  it("bytesToIntelHex でロードした命令語を読める", () => {
    const hex = bytesToIntelHex(0x8000, ADD_PROGRAM_WORDS);
    const t = createTms9995CodeTest();
    t.loadIntelHex(hex);
    expect(tmsReadWord(0x8000)).toBe(0xa083);
    expect(tmsReadWord(0x8002)).toBe(0x044b);
  });
});
