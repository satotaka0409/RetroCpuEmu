/**
 * assembleAndLink ユニットテスト（フレームワーク fixture のみ）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCdb } from "../../retrocpu_emu_ts/src/code_test/cdb.js";
import {
  assembleAndLink,
  assembleToHexCdb,
  lookupByteAddr,
  lookupWordAddr,
} from "../src/assemble_link.js";
import { FRAMEWORK_BUILD } from "../src/repo.js";
import { expect, test } from "../src/unit.js";

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/**
 * fixture 配下のパス。
 * @param p 相対パス
 * @returns 絶対パス
 */
const fixture = (...p: string[]) => path.join(fixtures, ...p);

test("MAIN 無しならスタブで _CODE を 0x0200 から置く", () => {
  const linked = assembleAndLink({
    sources: [{ file: fixture("lib.asm") }],
  });
  expect(linked.globals.get("GL_LIB_ENTRY")!).toBeGreaterThanOrEqual(0x0200);
  expect(linked.globals.get("__TEST_FRAME_MAIN")).toBe(0x0200);
});

test("MAIN 付きで HEX / CDB を書き、gl_main が CDB にある", () => {
  const hexFile = path.join(FRAMEWORK_BUILD, "assemble_link_fix.ihx");
  const cdbFile = path.join(FRAMEWORK_BUILD, "assemble_link_fix.cdb");
  const linked = assembleToHexCdb({
    sources: [
      { file: fixture("main.asm"), module: "MAIN" },
      { file: fixture("lib.asm") },
    ],
    hexFile,
    cdbFile,
  });
  expect(linked.globals.has("GL_MAIN")).toBe(true);
  expect(linked.globals.has("GL_LIB_ENTRY")).toBe(true);
  expect(fs.existsSync(hexFile)).toBe(true);
  expect(fs.existsSync(cdbFile)).toBe(true);
  const cdb = parseCdb(fs.readFileSync(cdbFile, "utf8"));
  const main = cdb.byName.get("GL_MAIN");
  expect(main).toBeDefined();
  expect(main!.byteAddr % 2).toBe(0);
  expect(main!.wordAddr).toBe(linked.globals.get("GL_MAIN"));
  expect(fs.readFileSync(hexFile, "utf8")).toContain(":00000001FF");
});

test("TMS9995: MAIN 無しでも MN1613 用スタブを挿入しない", () => {
  const linked = assembleAndLink({
    cpu: "tms9995",
    sources: [
      {
        text: [
          "\t.cpu\ttms9995",
          "\t.area\t_CODE\t\t(REL,CON)",
          "\t.global\tGL_TMS_ENTRY",
          "GL_TMS_ENTRY:",
          "\tnop",
          "",
        ].join("\n"),
        module: "LIBTMS",
      },
    ],
  });
  expect(linked.cpu).toBe("tms9995");
  expect(linked.globals.has("__TEST_FRAME_MAIN")).toBe(false);
  expect(lookupByteAddr(linked, "GL_TMS_ENTRY")).toBe(0);
});

test("TMS9995: 奇数バイト位置のグローバルを扱える", () => {
  const linked = assembleAndLink({
    cpu: "tms9995",
    sources: [
      {
        text: [
          "\t.cpu\ttms9995",
          "\t.area\t_CODE\t\t(REL,CON)",
          "\t.org\t0x0000",
          "\tnop",
          "\t.ds\t1",
          "\t.global\tGL_ODD",
          "GL_ODD:",
          "\tnop",
          "",
        ].join("\n"),
        module: "MAIN",
      },
    ],
  });
  expect(linked.cpu).toBe("tms9995");
  expect(lookupByteAddr(linked, "GL_ODD")).toBe(3);
  expect(linked.globalBytes.get("GL_ODD")).toBe(3);
  expect(linked.globals.get("GL_ODD")).toBe(1);
  expect(() => lookupWordAddr(linked, "GL_ODD")).toThrow(/MN1613-only/);
});
