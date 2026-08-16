/**
 * MN1613 逆アセンブルとグローバルラベル表示
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Mn1613Disassembler } from "./mn1613_disassembler";
import { Mn1613LabelTable } from "./labels";

describe("Mn1613LabelTable.lookupGlobal", () => {
  test("G だけ返し F は返さない", () => {
    const t = new Mn1613LabelTable();
    t.addLabel("local_foo", 0x200, "F");
    t.addLabel("g_main", 0x108, "G");
    assert.equal(t.lookupGlobal(0x108), "g_main");
    assert.equal(t.lookup(0x200), "local_foo");
    assert.equal(t.lookupGlobal(0x200), undefined);
  });
});

describe("Mn1613Disassembler", () => {
  test("H を逆アセンブルする", () => {
    const dis = new Mn1613Disassembler();
    const r = dis.disassemble(0x108, (a) => (a === 0x108 ? 0x2000 : 0));
    assert.equal(r.text, "H");
    assert.equal(r.wordCount, 1);
    assert.equal(r.nextAddr, 0x109);
  });

  test("BD の先がグローバルならオペランドをラベルにする", () => {
    const dis = new Mn1613Disassembler();
    dis.addLabel("g_main", 0x108, "G");
    const r = dis.disassemble(0x200, (a) => {
      if (a === 0x200) return 0x2607; // BD
      if (a === 0x201) return 0x0108;
      return 0;
    });
    assert.equal(r.text, "BD g_main");
    assert.equal(r.wordCount, 2);
  });

  test("ファイル局所ラベルはオペランドに出さない", () => {
    const dis = new Mn1613Disassembler();
    dis.addLabel("l_loop", 0x108, "F");
    const r = dis.disassemble(0x200, (a) => {
      if (a === 0x200) return 0x2607;
      if (a === 0x201) return 0x0108;
      return 0;
    });
    assert.match(r.text, /^BD 0x0108$/);
  });
});
