/**
 * コードテスト・ミドルウェア試験
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

import { describe, expect, it } from "vitest";
import {
  createMn1613CodeTest,
  parseCdb,
  readWord,
  wordsToIntelHex,
} from "../../../main/feature/code_test";

describe("intel hex + cdb", () => {
  it("wordsToIntelHex / parseCdb でバイトアドレスが一致する", () => {
    const hex = wordsToIntelHex(0x1800, [0x5809, 0x2003]);
    expect(hex).toContain(":04");
    const cdb = parseCdb("L:G$add$0$0:3000\n");
    expect(cdb.byName.get("add")?.byteAddr).toBe(0x3000);
    expect(cdb.byName.get("add")?.wordAddr).toBe(0x1800);
  });

  it("奇数バイトアドレスの CDB はエラー", () => {
    expect(() => parseCdb("L:G$bad$0$0:3001\n")).toThrow(/odd/);
  });
});

describe("Mn1613CodeTest.call", () => {
  it("R0=R0+R1 を呼び出し R0 を検証する", async () => {
    // word 0x1800: A R0,R1 (0x5809); RET (0x2003)
    const hex = wordsToIntelHex(0x1800, [0x5809, 0x2003]);
    const cdb = "L:G$add$0$0:3000\n";

    const t = createMn1613CodeTest({ maxCycles: 10_000 });
    t.loadIntelHex(hex);
    t.loadCdb(cdb);

    const r = await t.call("add", { registers: { R0: 3, R1: 4 } });
    expect(r.registers.R[0]).toBe(7);
    t.expectRegisters({ R0: 7, R1: 4 });
  });

  it("ゼロページとラベル初期化・メモリ検証", async () => {
    // word 0x1800: L R0, 0x10 (ゼロページ); RET
    // L rrr=0 mmm=0 d=0x10 → op group 0x18|mmm = 0x18, rrr=0, d=0x10 → 0xC010?
    // From emu: op >= 0x10 is L/ST. isHi=(op&8)!=0 for L.
    // L R0,d: op=0x18+(mmm=0)=0x18, rrr=0, lo=d → 0xC010
    // Actually encoding: (op<<11)|(rrr<<8)|d
    // op=0x18 → 0x18<<11 = 0xC000, rrr=0 → 0xC010 for d=0x10. Yes.
    const hex = wordsToIntelHex(0x1800, [0xc010, 0x2003]);
    const cdb = ["L:G$loadzp$0$0:3000", "L:G$buf$0$0:0200", ""].join("\n");

    const t = createMn1613CodeTest();
    t.loadIntelHex(hex);
    t.loadCdb(cdb);
    t.writeZeroPageWords({ 0x10: 0xabcd });
    t.writeLabelWords("buf", [0x1111, 0x2222]);

    await t.call("loadzp", { registers: { R0: 0 } });
    t.expectRegisters({ R0: 0xabcd });
    t.expectLabelWords("buf", [0x1111, 0x2222]);
    t.expectMemoryWords(0x0100, [0x1111, 0x2222]); // byte 0x200 → word 0x100
  });

  it("スタックワーク: 引数ワードが preCallSp+2 にある", async () => {
    // RET only
    const hex = wordsToIntelHex(0x1800, [0x2003]);
    const cdb = "L:G$retonly$0$0:3000\n";
    const t = createMn1613CodeTest();
    t.loadIntelHex(hex);
    t.loadCdb(cdb);
    await t.call("retonly", { stack: [0x55aa] });
    // preCallSp = FFFD; +1 = return stub word; +2 = 0x55aa
    t.expectStackWork({ from: "preCallSp", offset: 2, words: [0x55aa] });
    expect(readWord(0xffff)).toBe(0x55aa);
  });
});
