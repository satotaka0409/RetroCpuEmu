/**
 * コードテスト・ミドルウェア試験
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMn1613CodeTest,
  createMn1613CodeTestFromSettings,
  parseCdb,
  parseCodeTestSettings,
  readWord,
  wordsToIntelHex,
  type Mn1613CodeTest,
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

describe("Mn1613CodeTest.ioMock", () => {
  let harness: Mn1613CodeTest | undefined;

  afterEach(async () => {
    await harness?.detachIoMock();
    harness = undefined;
  });

  it("ioMock が無ければ RD は既定 0xFFFF", async () => {
    // RD R0, 0x24; RET
    const hex = wordsToIntelHex(0x1800, [0x1824, 0x2003]);
    harness = createMn1613CodeTest();
    harness.loadIntelHex(hex);
    harness.loadCdb("L:G$rdio$0$0:3000\n");
    await harness.call("rdio");
    harness.expectRegisters({ R0: 0xffff });
  });

  it("port モックの RD 固定値が R0 に入る", async () => {
    const hex = wordsToIntelHex(0x1800, [0x1824, 0x2003]);
    harness = createMn1613CodeTest({
      ioMock: [{ type: "port", port: "0x24", read: "0x00AB" }],
    });
    harness.loadIntelHex(hex);
    harness.loadCdb("L:G$rdio$0$0:3000\n");
    await harness.call("rdio");
    harness.expectRegisters({ R0: 0x00ab });
  });

  it("port モックの read 配列は読むたびに進む", async () => {
    // RD R0, 0x24; RD R1, 0x24; RET
    const hex = wordsToIntelHex(0x1800, [0x1824, 0x1924, 0x2003]);
    harness = createMn1613CodeTest({
      ioMock: [{ type: "port", port: "0x24", read: ["0x11", "0x22"] }],
    });
    harness.loadIntelHex(hex);
    harness.loadCdb("L:G$rd2$0$0:3000\n");
    await harness.call("rd2");
    harness.expectRegisters({ R0: 0x11, R1: 0x22 });
  });

  it("WT は ioMock.writes に残り expectIoWrites できる", async () => {
    // MVI R0, #0x5A; WT R0, 0x23; RET
    const hex = wordsToIntelHex(0x1800, [0x085a, 0x1023, 0x2003]);
    harness = createMn1613CodeTest({
      ioMock: [{ type: "port", port: "0x23" }],
    });
    harness.loadIntelHex(hex);
    harness.loadCdb("L:G$wtio$0$0:3000\n");
    await harness.call("wtio");
    harness.expectIoWrites([{ port: 0x23, value: 0x5a }]);
  });

  it("handshake エントリをキックすると HSHK_CTRL が 0 で読める", async () => {
    // RD R0, 0x22; RET
    const hex = wordsToIntelHex(0x1800, [0x1822, 0x2003]);
    harness = createMn1613CodeTest({
      ioMock: [{ type: "handshake", timeoutMs: 1000, syncIrq2: false }],
    });
    harness.loadIntelHex(hex);
    harness.loadCdb("L:G$rdctrl$0$0:3000\n");
    await harness.call("rdctrl");
    harness.expectRegisters({ R0: 0 });
    expect(harness.ioMock?.handshake).toBeTruthy();
  });

  it("設定 JSON ファイルの ioMock でハーネスがキックされる", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-test-io-"));
    try {
      const hex = wordsToIntelHex(0x1800, [0x1824, 0x2003]);
      fs.writeFileSync(path.join(dir, "rd.ihx"), hex);
      fs.writeFileSync(path.join(dir, "rd.cdb"), "L:G$rdio$0$0:3000\n");
      const jsonPath = path.join(dir, "settings.json");
      fs.writeFileSync(
        jsonPath,
        JSON.stringify({
          hexFile: "rd.ihx",
          cdbFile: "rd.cdb",
          ioMock: [{ type: "port", port: "0x24", read: "0x00C3" }],
        }),
      );
      harness = createMn1613CodeTestFromSettings(jsonPath);
      await harness.call("rdio");
      harness.expectRegisters({ R0: 0x00c3 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parseCodeTestSettings は ioMock 配列を受け付ける", () => {
    const s = parseCodeTestSettings({
      hexFile: "a.ihx",
      ioMock: [
        { type: "handshake", timeoutMs: "0x1388", syncIrq2: false },
        { type: "port", port: "0x30", read: [1, "0x02"] },
      ],
    });
    expect(s.ioMock).toHaveLength(2);
    expect(s.ioMock?.[0]).toMatchObject({ type: "handshake", timeoutMs: 0x1388 });
    expect(s.ioMock?.[1]).toMatchObject({ type: "port", port: "0x30" });
  });
});
