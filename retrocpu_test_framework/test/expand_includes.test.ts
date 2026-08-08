import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expandIncludes } from "../src/expand_includes.js";

describe("expandIncludes", () => {
  it(".inc は展開する", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-inc-"));
    fs.writeFileSync(path.join(dir, "io.inc"), "HSHK_OK\t.equ\t0\n");
    const src = '\t.include "io.inc"\n\tnop\n';
    expect(expandIncludes(src, dir)).toContain("HSHK_OK");
    expect(expandIncludes(src, dir)).toContain("nop");
  });

  it(".asm の include は拒否する", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtf-asm-"));
    fs.writeFileSync(path.join(dir, "other.asm"), "\tnop\n");
    expect(() => expandIncludes('\t.include "other.asm"\n', dir)).toThrow(
      /Cannot \.include assembler source/,
    );
  });
});
