/**
 * sdld 結合: asxxxx REL → シンボル解決・s__WORK / ワードアドレス
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assemble } from "../main/assembler";
import { writeRel } from "../main/relWriter";
import { findSdld, linkRelsWithSdld } from "../main/sdldLink";

/**
 * 一時ディレクトリに .rel を書いてパスを返す。
 * @param name ファイル名
 * @param rel REL 本文
 * @param dir 親ディレクトリ
 * @returns 絶対パス
 */
function writeRelFile(dir: string, name: string, rel: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, rel, "utf8");
  return p;
}

describe("sdld: asxxxx REL をリンクできる", () => {
  test("sdld が PATH / SDCC_BIN_DIR にある", () => {
    assert.ok(findSdld().length > 0);
  });

  test("BALD 外部の第2語はワードアドレス", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdld-bald-"));
    try {
      const defRel = writeRel(
        assemble(`
        .cpu    mn1613
        .area   _CODE           (REL,CON)
        .globl  FOO
        h
        h
FOO:    h
`),
        "DEFS",
      );
      const useRel = writeRel(
        assemble(`
        .cpu    mn1613
        .area   _CODE           (REL,CON)
        .globl  FOO
        bald    FOO
        h
`),
        "USE",
      );
      const defPath = writeRelFile(dir, "main.rel", defRel);
      const usePath = writeRelFile(dir, "use.rel", useRel);
      const linked = linkRelsWithSdld([defPath, usePath], { workDir: dir });
      assert.equal(linked.defs.get("FOO"), 4);
      const img = linked.image;
      const baldAt = 6;
      assert.equal(img[baldAt], 0x26);
      assert.equal(img[baldAt + 1], 0x17);
      assert.equal(img[baldAt + 2], 0x00);
      assert.equal(img[baldAt + 3], 0x02, "FOO はワードアドレス 2");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CDB に s__WORK / l__WORK が出る", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdld-work-"));
    try {
      const rel = writeRel(
        assemble(`
        .cpu    mn1613
        .area   _CODE           (REL,CON)
        .globl  START
        .globl  s__WORK
        .globl  l__WORK
START:  mvwi    X0, #s__WORK
        mvwi    R1, #l__WORK
        h
        .area   _WORK           (REL,NOLOAD)
        .ds     4
`),
        "MAIN",
      );
      const relPath = writeRelFile(dir, "main.rel", rel);
      const linked = linkRelsWithSdld([relPath], { workDir: dir });
      assert.ok(
        linked.cdbText.includes("L:G$s__WORK$") ||
          linked.cdbText.includes("L:G$s__WORK$0$0:"),
        linked.cdbText,
      );
      assert.ok(
        linked.cdbText.includes("L:G$l__WORK$") ||
          /L:G\$l__WORK\$/.test(linked.cdbText),
        linked.cdbText,
      );
      const sWork = [...linked.defs.entries()].find(
        ([n]) => n.toUpperCase() === "S__WORK",
      );
      const lWork = [...linked.defs.entries()].find(
        ([n]) => n.toUpperCase() === "L__WORK",
      );
      assert.ok(sWork, "s__WORK in defs");
      assert.ok(lWork, "l__WORK in defs");
      assert.equal(lWork![1], 8, "l__WORK は 4 ワード = 8 バイト");
      const img = linked.image;
      const imm0 = (img[2]! << 8) | img[3]!;
      const imm1 = (img[6]! << 8) | img[7]!;
      assert.equal(imm0, sWork![1] >>> 1, "mvwi 即値はワード開始");
      assert.equal(imm1, lWork![1] >>> 1, "mvwi 即値はワード長");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
