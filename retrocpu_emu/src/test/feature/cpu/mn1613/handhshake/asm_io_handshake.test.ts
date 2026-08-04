/**
 * CPU アセンブラ ↔ IO TypeScript ハンドシェイク結合テスト
 * 根拠: HandShake.mdc
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getMemory,
  getState,
  reset,
  run,
  setIoReadCallback,
  setIoWriteCallback,
  setMemory,
  setPins,
} from "../../../../../main/feature/cpu/mn1613/mn1613";
import { IoControlHandshake } from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_ioboard";
import { createHandshakeBus } from "../../../../../main/feature/cpu/mn1613/handhshake/handshake_type";
import { createHandshakeIoPortBridge } from "../../../../../main/feature/board/handshake/io_port_bridge";

const require = createRequire(import.meta.url);
const asmRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../retrocpu_asm",
);
const { expandIncludesFromFile } = require(
  path.join(asmRoot, "dist/main/cli.js"),
) as {
  expandIncludesFromFile: (p: string) => string;
};
const { assemble } = require(path.join(asmRoot, "dist/main/assembler.js")) as {
  assemble: (
    src: string,
    cpu: string,
  ) => {
    words: { address: number; value: number }[];
    symbols: Map<string, number>;
  };
};

const handshakeAsmDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../cursor_expand/monitor/mn1613/src/handshake",
);

type AsmImage = {
  words: { address: number; value: number }[];
  symbols: Map<string, number>;
};

function assembleFile(name: string): AsmImage {
  const src = expandIncludesFromFile(path.join(handshakeAsmDir, name));
  return assemble(src, "mn1613");
}

function loadSparse(words: { address: number; value: number }[]): void {
  const buf = new ArrayBuffer(0x20000);
  const view = new DataView(buf);
  for (const w of words) {
    const off = (w.address & 0xffff) * 2;
    if (off + 1 < view.byteLength) {
      view.setUint16(off, w.value & 0xffff, false);
    }
  }
  setMemory(buf);
}

function readWord(addr: number): number {
  const view = new DataView(getMemory());
  return view.getUint16((addr & 0xffff) * 2, false);
}

beforeEach(() => {
  setPins({
    HLT: false,
    RST: false,
    IRQ0: false,
    IRQ1: false,
    IRQ2: false,
    BSAV: false,
    STRT: false,
  });
  reset();
});

describe("asm CPU ↔ TS IO handshake", () => {
  it(
    "CPU→IO: アセンブラ送信を IoControlHandshake.receive が受け取る",
    async () => {
    const img = assembleFile("handshake_cpu_to_io_test.asm");
    loadSparse(img.words);

    const bus = createHandshakeBus();
    const bridge = createHandshakeIoPortBridge(bus);
    setIoReadCallback((p) => bridge.read(p));
    setIoWriteCallback((p, v) => bridge.write(p, v));

    const io = new IoControlHandshake(bus, 5000);
    const [received, status] = await Promise.all([
      io.receive(2),
      run(0x0200, 200_000),
    ]);

    expect(status).toBe("halted");
    expect([...received]).toEqual([0xab, 0xcd]);
    const resultAddr = img.symbols.get("GL_HSHK_TEST_RESULT");
    expect(resultAddr).toBeDefined();
    expect(readWord(resultAddr!)).toBe(0x00);
    expect(getState().R[0]).toBe(0x00);
  },
    15000,
  );

  it(
    "IO→CPU: IoControlHandshake.send をアセンブラ受信が受け取る",
    async () => {
    const img = assembleFile("handshake_io_to_cpu_test.asm");
    loadSparse(img.words);

    const bus = createHandshakeBus();
    const bridge = createHandshakeIoPortBridge(bus);
    setIoReadCallback((p) => bridge.read(p));
    setIoWriteCallback((p, v) => bridge.write(p, v));

    const io = new IoControlHandshake(bus, 5000);
    const payload = new Uint8Array([0x12, 0x34]);
    const [status] = await Promise.all([
      run(0x0200, 200_000),
      io.send(payload),
    ]);

    expect(status).toBe("halted");
    const resultAddr = img.symbols.get("GL_HSHK_TEST_RESULT")!;
    const buf0 = img.symbols.get("GL_HSHK_TEST_BUF0")!;
    const buf1 = img.symbols.get("GL_HSHK_TEST_BUF1")!;
    expect(readWord(resultAddr)).toBe(0x00);
    expect(readWord(buf0) & 0xff).toBe(0x12);
    expect(readWord(buf1) & 0xff).toBe(0x34);
  },
    15000,
  );
});
