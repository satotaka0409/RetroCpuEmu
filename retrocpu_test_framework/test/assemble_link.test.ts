import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCdb } from "@emu/main/feature/code_test/cdb";
import {
  assembleAndLink,
  assembleToHexCdb,
} from "../src/assemble_link.js";
import { FRAMEWORK_BUILD, MONITOR_SRC } from "../src/repo.js";

const src = (...p: string[]) => path.join(MONITOR_SRC, ...p);

describe("assembleAndLink", () => {
  it("MAIN 無しならスタブで _CODE を 0x0200 から置く", () => {
    const linked = assembleAndLink({
      sources: [
        { file: src("handshake/handshake_timer.asm") },
        { file: src("handshake/handshake_common.asm") },
        { file: src("bios/bios_common.asm") },
      ],
    });
    expect(linked.globals.get("GL_BIOS_TIMER_SET")).toBeGreaterThanOrEqual(0x0200);
    expect(linked.globals.get("GL_RND_INIT")).toBeGreaterThanOrEqual(0x0200);
    expect(linked.globals.get("__TEST_FRAME_MAIN")).toBe(0x0200);
  });

  it("モニタをリンクして HEX / CDB を書き、gl_main が CDB にある", () => {
    const hexFile = path.join(FRAMEWORK_BUILD, "assemble_link_mon.ihx");
    const cdbFile = path.join(FRAMEWORK_BUILD, "assemble_link_mon.cdb");
    const linked = assembleToHexCdb({
      sources: [
        { file: src("main.asm"), module: "MAIN" },
        { file: src("interrupt.asm") },
        { file: src("handshake/handshake_common.asm") },
        { file: src("handshake/handshake_main.asm") },
        { file: src("handshake/handshake_timer.asm") },
        { file: src("bios/bios_common.asm") },
      ],
      hexFile,
      cdbFile,
    });
    expect(linked.globals.has("GL_MAIN")).toBe(true);
    expect(linked.globals.has("GL_BIOS_TIMER_SET")).toBe(true);
    expect(fs.existsSync(hexFile)).toBe(true);
    expect(fs.existsSync(cdbFile)).toBe(true);
    const cdb = parseCdb(fs.readFileSync(cdbFile, "utf8"));
    const main = cdb.byName.get("GL_MAIN");
    expect(main).toBeDefined();
    expect(main!.byteAddr % 2).toBe(0);
    expect(main!.wordAddr).toBe(linked.globals.get("GL_MAIN"));
    expect(fs.readFileSync(hexFile, "utf8")).toContain(":00000001FF");
  });
});
