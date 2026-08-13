/**
 * HEX / CDB ロードと画面状態組み立ての試験
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { wordsToIntelHex } from "./intelHex";
import { parseCdb } from "./cdb";
import { ProgramSession } from "./programSession";

describe("loadIntelHex + ProgramSession", () => {
  test("HEX を展開しエントリは最小アドレスのワード", () => {
    // ワード 0x0108 に H (0x2000)
    const hex = wordsToIntelHex(0x0108, [0x2000, 0x4801]);
    const s = new ProgramSession();
    const info = s.loadHex(hex, "t.ihx");
    assert.equal(info.minAddr, 0x0108 * 2);
    assert.equal(s.readWord(0x0108), 0x2000);
    assert.equal(s.readWord(0x0109), 0x4801);
    assert.equal(s.entryWord, 0x0108);
  });

  test("CDB の main があればエントリ優先", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000]);
    const cdb = "L:G$main$0$0:0220\n"; // byte 0x220 = word 0x110
    const s = new ProgramSession();
    s.loadHex(hex, "t.ihx");
    // put something at main too so mem is valid
    s.memory[0x220] = 0x20;
    s.memory[0x221] = 0x00;
    s.loadCdb(cdb, "t.cdb");
    assert.equal(s.entryWord, 0x110);
  });

  test("toViewState は逆アセンブル行を出す", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000]); // H
    const s = new ProgramSession();
    s.loadHex(hex, "halt.ihx");
    const st = s.toViewState();
    assert.ok(st.disasm.length >= 1);
    assert.match(st.disasm[0]!.text, /^H\b/);
    assert.equal(st.disasm[0]!.addr, "0108");
    assert.equal(st.current.IC, "0108");
    assert.match(st.title, /halt\.ihx/);
  });
});

describe("parseCdb", () => {
  test("ラベルとチェックポイントを分ける", () => {
    const t = parseCdb(
      [
        "L:G$gl_main$0$0:0210",
        "L:__CP$boot$0001:0210",
        "L:F$local$0$0:0300",
      ].join("\n"),
    );
    assert.equal(t.byName.get("gl_main")?.wordAddr, 0x108);
    assert.equal(t.checkpoints.length, 1);
    assert.equal(t.checkpoints[0]!.name, "boot");
    assert.ok(!t.byName.has("boot"));
  });
});
