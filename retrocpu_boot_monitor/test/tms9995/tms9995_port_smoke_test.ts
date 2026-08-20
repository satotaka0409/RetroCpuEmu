import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expect,
  resolveSuitePath,
  test,
} from "../../../retrocpu_test_framework/src/index.js";
import { tms9995MonSettings } from "./tms9995_mon_settings.js";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

function resolveHexPath(): string {
  return resolveSuitePath(tms9995MonSettings.hexFile, THIS_DIR);
}

function resolveCdbPath(): string {
  return resolveSuitePath(tms9995MonSettings.cdbFile ?? "", THIS_DIR);
}

function parseCdbGlobals(cdbText: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = cdbText.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const m = line.match(/^L:G\$([A-Z0-9_.$]+)\$0\$0:([0-9A-Fa-f]+)$/);
    if (!m) continue;
    out.set(m[1]!, parseInt(m[2]!, 16));
  }
  return out;
}

test("tms9995_mon の ihx/cdb が存在し空でない", () => {
  const hex = resolveHexPath();
  const cdb = resolveCdbPath();
  expect(fs.existsSync(hex)).toBe(true);
  expect(fs.existsSync(cdb)).toBe(true);
  expect(fs.statSync(hex).size > 0).toBe(true);
  expect(fs.statSync(cdb).size > 0).toBe(true);
});

test("BIOS 公開エントリが 0x0110 起点で連続している", () => {
  const cdbText = fs.readFileSync(resolveCdbPath(), "utf8");
  const globals = parseCdbGlobals(cdbText);
  const expectAddrs: ReadonlyArray<readonly [string, number]> = [
    ["G_MAIN", 0x0110],
    ["G_MAIN_LOOP", 0x0114],
    ["G_GET_RND", 0x0118],
    ["G_MEM_CPY", 0x011c],
    ["G_MALLOC", 0x0120],
    ["G_FREE", 0x0124],
    ["G_MALLOC2", 0x0128],
    ["G_FREE2", 0x012c],
    ["G_BIOS_MODE_SET", 0x0130],
    ["G_HSHK_GET_TIME", 0x0134],
    ["G_BIOS_TIMER_SET", 0x0138],
    ["G_BIOS_HEX_KEY_GET", 0x013c],
    ["G_BIOS_PC_KEY_GET", 0x0140],
    ["G_BIOS_LED_DISPLAY", 0x0144],
    ["G_BIOS_LCD_CONTROL", 0x0148],
    ["G_BIOS_LCD_TEXT", 0x014c],
    ["G_BIOS_BEEP", 0x0150],
    ["G_BIOS_RTC_GET_RAW", 0x0154],
    ["G_BIOS_TEMP_GET_RAW", 0x0158],
    ["G_BIOS_LIGHT_GET_RAW", 0x015c],
    ["G_BIOS_DISTANCE_GET_RAW", 0x0160],
  ];
  for (const [name, addr] of expectAddrs) {
    expect(globals.get(name)).toBe(addr);
  }
});

test("移植対象モジュールの主要シンボルが CDB に存在する", () => {
  const cdbText = fs.readFileSync(resolveCdbPath(), "utf8");
  const globals = parseCdbGlobals(cdbText);
  const required = [
    "G_INT0_HANDLER",
    "G_INT1_HANDLER",
    "G_INT2_HANDLER",
    "G_INT3_HANDLER",
    "G_HANDSHAKE_INTERRUPT_HANDLER",
    "G_BREAKPOINT_INTERRUPT_HANDLER",
    "G_STEP_INTERRUPT_HANDLER",
    "G_HSHK_INITIATE_SEND",
    "G_HSHK_SEND_BYTE",
    "G_HSHK_SEND_WORD",
    "G_HSHK_RECV_BYTE",
    "G_HSHK_FINALIZE_SEND",
    "G_HSHK_FINALIZE_RECV",
    "G_HSHK_READ_MEMORY",
    "G_HSHK_WRITE_MEMORY",
    "G_HSHK_READ_IO",
    "G_HSHK_WRITE_IO",
    "G_HSHK_ADDR_BREAK_SET",
    "G_HSHK_ADDR_BREAK_CLR",
    "G_HSHK_BREAK_HIST_GET",
    "G_HSHK_BREAK_RESUME",
    "G_BIOS_UNDEF_LED",
    "G_RND_INIT",
    "G_MALLOC_INIT",
    "G_MALLOC2_INIT",
  ] as const;
  for (const name of required) {
    expect(globals.has(name)).toBe(true);
  }
});
