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

  test("CDB の g_main が main より優先", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000]);
    const s = new ProgramSession();
    s.loadHex(hex, "t.ihx");
    s.loadCdb("L:G$main$0$0:0220\nL:G$g_main$0$0:0210\n", "t.cdb");
    assert.equal(s.entryWord, 0x108);
  });

  test("g_main が無ければ HEX 最小アドレス（main は使わない）", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000]);
    const cdb = "L:G$main$0$0:0220\n"; // byte 0x220 = word 0x110
    const s = new ProgramSession();
    s.loadHex(hex, "t.ihx");
    s.memory[0x220] = 0x20;
    s.memory[0x221] = 0x00;
    s.loadCdb(cdb, "t.cdb");
    assert.equal(s.entryWord, 0x108);
  });

  test("g_main があれば HEX 最小よりそのアドレスを使う", () => {
    const hex = wordsToIntelHex(0x0100, [0x2000, 0x2000, 0x2000, 0x2000]);
    const s = new ProgramSession();
    s.loadHex(hex, "t.ihx");
    s.memory[0x220] = 0x20;
    s.memory[0x221] = 0x00;
    s.loadCdb("L:G$g_main$0$0:0220\n", "t.cdb");
    assert.equal(s.entryWord, 0x110);
    const st = s.toViewState();
    assert.equal(st.disasm[0]!.addr, "00110");
    assert.equal(st.disasm[0]!.label, "g_main");
  });

  test("グローバルラベルがある番地は label を付ける（F は付けない）", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000, 0x2000]);
    const s = new ProgramSession();
    s.loadHex(hex, "t.ihx");
    s.loadCdb("L:G$g_main$0$0:0210\nL:F$l_skip$0$0:0212\n", "t.cdb");
    const lines = s.buildDisasm(0x108, 4);
    assert.equal(lines[0]!.label, "g_main");
    assert.equal(lines[0]!.addr, "00108");
    assert.equal(lines[0]!.text, "H");
    assert.equal(lines[1]!.addr, "00109");
    assert.equal(lines[1]!.label, undefined);
  });

  test("buildDisasm は endWord まで窓全体を出す", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000, 0x2000, 0x2000, 0x2000]);
    const s = new ProgramSession();
    s.loadHex(hex, "t.ihx");
    const lines = s.buildDisasm(0x108, 100, 0x10b, 0x109);
    assert.equal(lines.length, 4);
    assert.equal(lines[0]!.addr, "00108");
    assert.equal(lines[3]!.addr, "0010B");
    assert.equal(lines[1]!.current, true);
    assert.equal(lines[0]!.current, false);
  });

  test("patchBytes は 83h 窓を重ね書きする", () => {
    const s = new ProgramSession();
    s.patchBytes(0x0108 * 2, Uint8Array.from([0x20, 0x00]));
    assert.equal(s.readWord(0x108), 0x2000);
  });

  test("toViewState は逆アセンブル行を出す", () => {
    const hex = wordsToIntelHex(0x0108, [0x2000]); // H
    const s = new ProgramSession();
    s.loadHex(hex, "halt.ihx");
    const st = s.toViewState();
    assert.ok(st.disasm.length >= 1);
    assert.match(st.disasm[0]!.text, /^H\b/);
    assert.equal(st.disasm[0]!.addr, "00108");
    assert.equal(st.current.IC, "0108");
    assert.equal(st.memDump[0]!.addr, "00000");
    assert.equal(st.memDump[0]!.words[0], "0000");
    assert.equal(st.memStart, 0x0108);
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
