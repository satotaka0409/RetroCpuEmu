import { describe, expect, it } from "vitest";
import { parseCdb } from "@emu/main/feature/code_test/cdb";
import { loadIntelHex } from "@emu/main/feature/code_test/intel_hex";
import { defsToCdb, imageToIntelHex } from "../src/hex_cdb.js";

describe("hex_cdb", () => {
  it("imageToIntelHex はゼロ塊を省略し EOF で終わる", () => {
    const image = new Uint8Array(32);
    image[16] = 0x7d;
    image[17] = 0x07;
    const hex = imageToIntelHex(image);
    expect(hex).not.toContain(":10000000");
    expect(hex).toContain(":10001000");
    expect(hex.trim().endsWith(":00000001FF")).toBe(true);
  });

  it("defsToCdb は L:G レコードになり parseCdb と一致する", () => {
    const defs = new Map<string, number>([
      ["GL_MAIN", 0x0610],
      ["GL_BIOS_TIMER_SET", 0x0800],
    ]);
    const text = defsToCdb(defs);
    const table = parseCdb(text);
    expect(table.byName.get("GL_MAIN")?.wordAddr).toBe(0x0308);
    expect(table.byName.get("GL_BIOS_TIMER_SET")?.byteAddr).toBe(0x0800);
  });

  it("HEX をバッファへ戻せる", () => {
    const image = new Uint8Array(20);
    image[0] = 0x12;
    image[1] = 0x34;
    const hex = imageToIntelHex(image);
    const buf = new ArrayBuffer(32);
    const view = new DataView(buf);
    loadIntelHex(hex, view);
    expect(view.getUint8(0)).toBe(0x12);
    expect(view.getUint8(1)).toBe(0x34);
  });
});
