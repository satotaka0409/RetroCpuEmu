/**
 * デバッグ TCP のアドレス／IO ブレイク（10h / 11h）
 * 根拠: retrocpu_debug.mdc
 */

import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import {
  addrBreakSetPayload,
  encodeAddrBreakClrFrame,
  encodeAddrBreakSetFrame,
  isAddrBreakSlot,
  parseAddrBreakClrSlot,
  parseAddrBreakSetFrame,
} from "../../src/ioboard/debug_addr_break";
import { DebugHost } from "../../src/ioboard/debug_host";
import { encodeMemReadFrame } from "../../src/ioboard/debug_mem_read";
import { encodeMemWriteFrame } from "../../src/ioboard/debug_mem_write";
import {
  CMD_IO_TO_CPU,
  RESPONSE_CODE,
} from "../../src/shared/handshake/handshake_type";

describe("debug_addr_break フレーム", () => {
  it("10h をビッグエンディアンで組み立てて読める", () => {
    const frame = encodeAddrBreakSetFrame({
      slot: 3,
      flags: 0x22,
      count: 7,
      addr: 0x00003000,
      data: 0x1234,
    });
    expect(frame.length).toBe(10);
    expect(frame[0]).toBe(CMD_IO_TO_CPU.BREAK_MEM_IO_SET);
    const parsed = parseAddrBreakSetFrame(frame);
    expect(parsed).toEqual({
      slot: 3,
      flags: 0x22,
      count: 7,
      addr: 0x00003000,
      data: 0x1234,
    });
    expect(addrBreakSetPayload(frame)?.length).toBe(9);
  });

  it("11h はコマンドとスロットだけ", () => {
    const frame = encodeAddrBreakClrFrame(3);
    expect(frame).toEqual(Uint8Array.from([CMD_IO_TO_CPU.BREAK_MEM_IO_CLR, 3]));
    expect(parseAddrBreakClrSlot(frame)).toBe(3);
  });

  it("スロットは 0–3 のみ有効", () => {
    expect(isAddrBreakSlot(0)).toBe(true);
    expect(isAddrBreakSlot(3)).toBe(true);
    expect(isAddrBreakSlot(4)).toBe(false);
    expect(isAddrBreakSlot(8)).toBe(false);
  });
});

describe("DebugHost TCP（IO が待ち受け、PC が接続）", () => {
  let host: DebugHost | null = null;

  afterEach(async () => {
    await host?.close();
    host = null;
  });

  /**
   * ホストへつなぎ、送信して 1 バイト応答を待つ。
   * @param port 待ち受けポート
   * @param send 送信バイト
   * @returns 応答 1 バイト
   */
  function roundTrip(port: number, send: Uint8Array): Promise<number> {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.write(Buffer.from(send));
      });
      sock.on("data", (chunk: Buffer) => {
        sock.end();
        resolve(chunk[0]!);
      });
      sock.on("error", reject);
    });
  }

  it("10h を受けて CPU 中継ハンドラへ 9 バイトを渡し、OK を返す", async () => {
    const seen: Uint8Array[] = [];
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async (payload) => {
          seen.push(Uint8Array.from(payload));
          return RESPONSE_CODE.OK;
        },
        addrBreakClr: async () => RESPONSE_CODE.NG,
      },
    });
    const port = await host.listen();
    const frame = encodeAddrBreakSetFrame({
      slot: 1,
      flags: 0x01,
      count: 0,
      addr: 0x00000020,
      data: 0,
    });
    const status = await roundTrip(port, frame);
    expect(status).toBe(RESPONSE_CODE.OK);
    expect(seen[0]).toEqual(frame.subarray(1));
  });

  it("11h はスロットを中継する", async () => {
    let clrSlot = -1;
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async (slot) => {
          clrSlot = slot;
          return RESPONSE_CODE.OK;
        },
      },
    });
    const port = await host.listen();
    const status = await roundTrip(port, encodeAddrBreakClrFrame(3));
    expect(status).toBe(RESPONSE_CODE.OK);
    expect(clrSlot).toBe(3);
  });

  it("スロット 4 は CPU へ渡さず NG", async () => {
    let called = false;
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => {
          called = true;
          return RESPONSE_CODE.OK;
        },
        addrBreakClr: async () => RESPONSE_CODE.OK,
      },
    });
    const port = await host.listen();
    const frame = encodeAddrBreakSetFrame({
      slot: 4,
      flags: 0,
      count: 0,
      addr: 0,
      data: 0,
    });
    const status = await roundTrip(port, frame);
    expect(status).toBe(RESPONSE_CODE.NG);
    expect(called).toBe(false);
  });

  it("未知コマンドは NG", async () => {
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.OK,
        addrBreakClr: async () => RESPONSE_CODE.OK,
      },
    });
    const port = await host.listen();
    const status = await roundTrip(port, Uint8Array.from([0x99]));
    expect(status).toBe(RESPONSE_CODE.NG);
  });

  it("13h はハンドシェイク相当のデータを status+長さ付きで返す", async () => {
    const seen: { byteAddr: number; byteCount: number }[] = [];
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memRead: async (byteAddr, byteCount) => {
          seen.push({ byteAddr, byteCount });
          return Uint8Array.from([0x12, 0x34, 0x56, 0x78]);
        },
      },
    });
    const port = await host.listen();
    const frame = encodeMemReadFrame(0x2000, 4);
    const body = await new Promise<Buffer>((resolve, reject) => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.write(Buffer.from(frame));
      });
      const chunks: Buffer[] = [];
      sock.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf.length >= 5) {
          const m = buf.readUInt32BE(1);
          if (buf.length >= 5 + m) {
            sock.end();
            resolve(buf);
          }
        }
      });
      sock.on("error", reject);
    });
    expect(body[0]).toBe(RESPONSE_CODE.OK);
    expect(body.readUInt32BE(1)).toBe(4);
    expect([...body.subarray(5)]).toEqual([0x12, 0x34, 0x56, 0x78]);
    expect(seen[0]).toEqual({ byteAddr: 0x2000, byteCount: 4 });
  });

  it("14h はハンドラへデータを渡し OK を返す", async () => {
    const seen: { byteAddr: number; data: number[] }[] = [];
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memWrite: async (byteAddr, data) => {
          seen.push({ byteAddr, data: [...data] });
        },
      },
    });
    const port = await host.listen();
    const frame = encodeMemWriteFrame(0x3000, new Uint8Array([0xab, 0xcd]));
    const status = await roundTrip(port, frame);
    expect(status).toBe(RESPONSE_CODE.OK);
    expect(seen[0]).toEqual({ byteAddr: 0x3000, data: [0xab, 0xcd] });
  });
});
