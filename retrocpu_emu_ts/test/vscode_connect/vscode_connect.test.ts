import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import { DebugHost } from "../../src/ioboard/debug_host";
import { RESPONSE_CODE } from "../../src/shared/handshake/handshake_type";
import { VsDebugClient, VS_DEBUG_STATUS } from "./vscode_debug_client";

describe("vscode_connect", () => {
  let host: DebugHost | null = null;
  let client: VsDebugClient | null = null;

  afterEach(async () => {
    client?.close();
    client = null;
    await host?.close();
    host = null;
  });

  it("83h 読み出し: VS Code クライアントが受信データを取得できる", async () => {
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memRead: async (byteAddr, byteCount) => {
          expect(byteAddr).toBe(0x00003000);
          expect(byteCount).toBe(4);
          return Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
        },
      },
    });
    const port = await host.listen();
    client = new VsDebugClient("127.0.0.1", port);

    const data = await client.memRead(0x00003000, 4);
    expect([...data]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("84h 書き込み: VS Code クライアントの payload がそのまま届く", async () => {
    const writes: Array<{ addr: number; data: number[] }> = [];
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memWrite: async (byteAddr, data) => {
          writes.push({ addr: byteAddr, data: [...data] });
        },
      },
    });
    const port = await host.listen();
    client = new VsDebugClient("127.0.0.1", port);

    const status = await client.memWrite(
      0x00004010,
      Uint8Array.from([0x11, 0x22, 0x33]),
    );
    expect(status).toBe(VS_DEBUG_STATUS.OK);
    expect(writes).toEqual([{ addr: 0x00004010, data: [0x11, 0x22, 0x33] }]);
  });

  it("80h/81h: ブレイク設定と解除が中継される", async () => {
    let setPayload: number[] = [];
    let clrSlot = -1;
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async (payload) => {
          setPayload = [...payload];
          return RESPONSE_CODE.OK;
        },
        addrBreakClr: async (slot) => {
          clrSlot = slot;
          return RESPONSE_CODE.OK;
        },
      },
    });
    const port = await host.listen();
    client = new VsDebugClient("127.0.0.1", port);

    const stSet = await client.breakSet({
      slot: 2,
      flags: 0x21,
      count: 3,
      addr: 0x00018000,
      data: 0xabcd,
    });
    const stClr = await client.breakClear(2);

    expect(stSet).toBe(VS_DEBUG_STATUS.OK);
    expect(stClr).toBe(VS_DEBUG_STATUS.OK);
    expect(setPayload).toEqual([
      2, 0x21, 3, 0x00, 0x01, 0x80, 0x00, 0xab, 0xcd,
    ]);
    expect(clrSlot).toBe(2);
  });

  it("分割送信でも 83h フレームを復元できる", async () => {
    let seen: { addr: number; count: number } | null = null;
    host = new DebugHost({
      port: 0,
      host: "127.0.0.1",
      handlers: {
        addrBreakSet: async () => RESPONSE_CODE.NG,
        addrBreakClr: async () => RESPONSE_CODE.NG,
        memRead: async (byteAddr, byteCount) => {
          seen = { addr: byteAddr, count: byteCount };
          return Uint8Array.from([0xaa, 0xbb]);
        },
      },
    });
    const port = await host.listen();

    const cmd = Uint8Array.from([
      0x83, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x02,
    ]);

    const response = await new Promise<Buffer>((resolve, reject) => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.write(Buffer.from(cmd.subarray(0, 2)));
        setTimeout(() => sock.write(Buffer.from(cmd.subarray(2, 6))), 5);
        setTimeout(() => sock.write(Buffer.from(cmd.subarray(6))), 10);
      });
      const chunks: Buffer[] = [];
      sock.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (buf.length >= 7) {
          sock.end();
          resolve(buf);
        }
      });
      sock.on("error", reject);
    });

    expect(seen).toEqual({ addr: 0x2000, count: 2 });
    expect(response[0]).toBe(VS_DEBUG_STATUS.OK);
    expect(response.readUInt32BE(1)).toBe(2);
    expect([...response.subarray(5, 7)]).toEqual([0xaa, 0xbb]);
  });
});
