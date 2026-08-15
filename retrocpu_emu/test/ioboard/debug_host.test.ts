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
    const frame = encodeAddrBreakClrFrame(5);
    expect(frame).toEqual(Uint8Array.from([CMD_IO_TO_CPU.BREAK_MEM_IO_CLR, 5]));
    expect(parseAddrBreakClrSlot(frame)).toBe(5);
  });

  it("スロットは 0–7 のみ有効", () => {
    expect(isAddrBreakSlot(0)).toBe(true);
    expect(isAddrBreakSlot(5)).toBe(true);
    expect(isAddrBreakSlot(7)).toBe(true);
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
    const status = await roundTrip(port, encodeAddrBreakClrFrame(4));
    expect(status).toBe(RESPONSE_CODE.OK);
    expect(clrSlot).toBe(4);
  });

  it("スロット 8 は CPU へ渡さず NG", async () => {
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
      slot: 8,
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
});
