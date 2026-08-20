/**
 * TMS9995 成果物セッションのユニットテスト。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assembleToHexCdb,
  createTms9995ArtifactSession,
  parseTms9995Cdb,
  expect,
  test,
} from "../src/index.js";

test("parseTms9995Cdb は奇数バイトアドレスを受け付ける", () => {
  const table = parseTms9995Cdb("L:G$ODD$0$0:0001\n");
  expect(table.byName.get("ODD")?.byteAddr).toBe(1);
});

test("成果物セッションは HEX/CDB をロードしシンボルとメモリを読める", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-tms-sess-"));
  const hexFile = path.join(dir, "t.ihx");
  const cdbFile = path.join(dir, "t.cdb");
  try {
    assembleToHexCdb({
      cpu: "tms9995",
      hexFile,
      cdbFile,
      sources: [
        {
          module: "MAIN",
          text: [
            "\t.cpu\ttms9995",
            "\t.global g_foo",
            "\t.area _CODE (REL,CON)",
            "g_foo:",
            "\tLI\tR1, #0x1234",
            "\tB\t(R11)",
          ].join("\n"),
        },
      ],
    });
    const session = createTms9995ArtifactSession({ hexFile, cdbFile });
    const addr = session.requireByteAddr("g_foo");
    expect(addr % 2).toBe(0);
    // LI R1,#imm のオペコード語が存在する
    const w0 = session.readWordBe(addr);
    expect(w0 !== 0).toBe(true);
    const plan = session.planCall({ args: [0x11, 0x22] });
    expect(plan.registers[1]).toBe(0x11);
    expect(plan.registers[2]).toBe(0x22);
    expect(plan.spAfterPush).toBe(session.defaultStackInit());
    expect(() => session.call("g_foo")).toThrow(/CPU emu/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
