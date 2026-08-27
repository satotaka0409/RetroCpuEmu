/**
 * `; @cp` 注入と CDB `__CP$` 出力
 * 根拠: asm_editor.mdc / asm_test_framework.mdc
 */
import { parseCdb } from "../../retrocpu_emu_ts/src/code_test/cdb.js";
import { assembleAndLink } from "../src/assemble_link.js";
import {
  checkpointId,
  checkpointsToCdb,
  createCheckpointState,
  injectCheckpoints,
} from "../src/checkpoint.js";
import { expect, test } from "../src/unit.js";

test("injectCheckpoints は次命令の直前にアンカーを置く", () => {
  const state = createCheckpointState();
  const out = injectCheckpoints(
    [
      "\t.cpu\tmn1613",
      "\t.area\t_CODE (REL,CON)",
      "; @cp uart_initialized",
      "\tnop",
      "; @cp uart_initialized",
      "\th",
      "",
    ].join("\n"),
    state,
  );
  expect(out).toContain("__CP0001:");
  expect(out).toContain("__CP0002:");
  expect(state.emitted[0]!.name).toBe("uart_initialized");
  expect(state.emitted[0]!.serial).toBe("0001");
  expect(state.emitted[0]!.anchorName).toBe("__CP0001");
  expect(state.emitted[1]!.serial).toBe("0002");
  expect(state.emitted[1]!.name).toBe("uart_initialized");
  expect(state.emitted[1]!.anchorName).toBe("__CP0002");
});

test("同一命令の同名 @cp はアンカー 1 つ、serial は 0001/0002", () => {
  const state = createCheckpointState();
  const out = injectCheckpoints(
    ["; @cp gl_get_rnd", "; @cp gl_get_rnd", "\tnop", ""].join("\n"),
    state,
  );
  expect((out.match(/__CP0001:/g) ?? []).length).toBe(1);
  expect(out).not.toContain("__CP0002:");
  expect(state.emitted[0]!.serial).toBe("0001");
  expect(state.emitted[1]!.serial).toBe("0002");
  expect(state.emitted[0]!.anchorName).toBe("__CP0001");
  expect(state.emitted[1]!.anchorName).toBe("__CP0001");
  expect(checkpointId("gl_get_rnd", "0001")).toBe("__CP$gl_get_rnd$0001");
  expect(checkpointId("gl_get_rnd", "0002")).toBe("__CP$gl_get_rnd$0002");
});

test("同一行の ; @cp はその命令に結びつく", () => {
  const state = createCheckpointState();
  const out = injectCheckpoints("\tnop\t\t; @cp same_line\n", state);
  expect(out.startsWith("\t.globl\t__CP0001")).toBe(true);
  expect(out).toContain("same_line");
  expect(state.emitted[0]!.name).toBe("same_line");
});

test("全角 ＠cp も半角 @cp と同じく注入する", () => {
  const state = createCheckpointState();
  const out = injectCheckpoints("; ＠cp fullwidth_at\n\tnop\n", state);
  expect(out).toContain("__CP0001:");
  expect(state.emitted[0]!.name).toBe("fullwidth_at");
});

test("不正なチェックポイント名は拒否する", () => {
  expect(() =>
    injectCheckpoints("; @cp 日本語\n\tnop\n", createCheckpointState()),
  ).toThrow(/invalid checkpoint name/);
  expect(() =>
    injectCheckpoints("; @cp has space\n\tnop\n", createCheckpointState()),
  ).toThrow(/invalid checkpoint name/);
});

test("結び先が無い @cp はエラー", () => {
  expect(() =>
    injectCheckpoints("; @cp dangling\n", createCheckpointState()),
  ).toThrow(/no following instruction/);
});

test("checkpointsToCdb は仕様どおり L:__CP$name$serial:addr", () => {
  const text = checkpointsToCdb(
    [{ name: "uart_initialized", serial: "0001", anchorName: "__CP0001" }],
    new Map([["__CP0001", 0x812a]]),
  );
  expect(text).toBe("L:__CP$uart_initialized$0001:812A\n");
  const table = parseCdb(text);
  expect(table.checkpoints).toEqual([
    {
      id: "__CP$uart_initialized$0001",
      name: "uart_initialized",
      serial: "0001",
      byteAddr: 0x812a,
      wordAddr: 0x4095,
    },
  ]);
  expect(table.symbols.length).toBe(0);
  expect(table.byName.get("uart_initialized")).toBe(undefined);
  expect(table.byName.get("__CP$uart_initialized$0001")).toBe(undefined);
});

test("assembleAndLink の CDB に __CP$ が出る", () => {
  const linked = assembleAndLink({
    cpu: "mn1613",
    sources: [
      {
        module: "MAIN",
        text: [
          "\t.cpu\tmn1613",
          "\t.area\t_CODE (REL,CON)",
          "\t.org\t0x0200",
          "\t.globl\tgl_main",
          "gl_main:",
          "; @cp main_halt",
          "\th",
          "",
        ].join("\n"),
      },
    ],
  });
  expect(linked.cdbText).toContain("L:__CP$main_halt$0001:");
  expect(linked.checkpoints).toEqual([
    {
      name: "main_halt",
      serial: "0001",
      id: "__CP$main_halt$0001",
      byteAddr: linked.checkpoints[0]!.byteAddr,
      wordAddr: linked.checkpoints[0]!.wordAddr,
    },
  ]);
  expect(linked.checkpoints[0]!.byteAddr % 2).toBe(0);
  expect(linked.checkpoints[0]!.wordAddr).toBe(linked.globals.get("GL_MAIN"));
  expect(linked.cdbText).not.toContain("L:G$__CP");
  expect(linked.cdbText).not.toContain("S __CP");
  const loaded = parseCdb(linked.cdbText);
  expect(loaded.checkpoints).toEqual([
    {
      id: "__CP$main_halt$0001",
      name: "main_halt",
      serial: "0001",
      byteAddr: linked.checkpoints[0]!.byteAddr,
      wordAddr: linked.checkpoints[0]!.wordAddr,
    },
  ]);
});

test("同一ワードの同名 @cp はアセンブルエラーにせず serial で分ける", () => {
  const linked = assembleAndLink({
    cpu: "mn1613",
    sources: [
      {
        module: "MAIN",
        text: [
          "\t.cpu\tmn1613",
          "\t.area\t_CODE (REL,CON)",
          "\t.org\t0x0200",
          "\t.globl\tgl_main",
          "gl_main:",
          "; @cp gl_get_rnd",
          "; @cp gl_get_rnd",
          "\th",
          "",
        ].join("\n"),
      },
    ],
  });
  expect(linked.checkpoints.length).toBe(2);
  expect(linked.checkpoints[0]!.id).toBe("__CP$gl_get_rnd$0001");
  expect(linked.checkpoints[1]!.id).toBe("__CP$gl_get_rnd$0002");
  expect(linked.checkpoints[0]!.byteAddr).toBe(linked.checkpoints[1]!.byteAddr);
  expect(linked.checkpoints[0]!.wordAddr).toBe(linked.globals.get("GL_MAIN"));
  expect(linked.cdbText).toContain("L:__CP$gl_get_rnd$0001:");
  expect(linked.cdbText).toContain("L:__CP$gl_get_rnd$0002:");
});
