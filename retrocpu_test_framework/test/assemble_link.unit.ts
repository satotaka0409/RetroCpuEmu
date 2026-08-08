/**
 * assembleAndLink ユニットテスト（フレームワーク fixture のみ）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCdb } from "../../retrocpu_emu/src/main/feature/code_test/cdb.js";
import { assembleAndLink, assembleToHexCdb } from "../src/assemble_link.js";
import { FRAMEWORK_BUILD } from "../src/repo.js";
import { expect, test } from "../src/unit.js";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

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
