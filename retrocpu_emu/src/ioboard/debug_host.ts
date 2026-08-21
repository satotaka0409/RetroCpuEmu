/**
 * IO ボード側のデバッグ TCP サーバ（PC＝クライアントがつなぐ）。
 * 根拠: retrocpu_debug.mdc。コマンド番号はハンドシェイクと同じ（80h/81h/83h/84h）。
 */

import net from "node:net";
import { getLogger } from "../log/logger";
import {
  addrBreakSetPayload,
  debugPcNeededBytes,
  isAddrBreakSlot,
  parseAddrBreakClrSlot,
  parseAddrBreakSetFrame,
} from "./debug_addr_break";
import { parseMemReadFrame } from "./debug_mem_read";
import { parseMemWriteFrame } from "./debug_mem_write";
import {
  DEBUG_MEM_MAX_BYTES,
  RESPONSE_CODE,
} from "../shared/handshake/handshake_type";

/** 製品の待ち受けポート（ベタ書き。PC 側がつなぎに来る） */
export const DEBUG_TCP_PORT = 29000;

/** 待ち受けアドレス。WSL 上のエミュへホスト PC からつなぐため全インタフェース */
export const DEBUG_TCP_HOST = "0.0.0.0";

/** CPU への 80h/81h/83h/84h 中継（ハンドシェイク結果を待って返す） */
export type DebugHostHandlers = {
  /**
   * アドレス／IO ブレイク設定（80h）を CPU へ中継する。
   * @param payload コマンド除く 9 バイト
   * @returns OK=0 / NG=1
   */
  addrBreakSet: (payload: Uint8Array) => Promise<number>;
  /**
   * アドレス／IO ブレイク解除（81h）を CPU へ中継する。
   * @param slot 設定番号 0–3
   * @returns OK=0 / NG=1
   */
  addrBreakClr: (slot: number) => Promise<number>;
  /**
   * メモリ読み出し（83h）を CPU ハンドシェイクへ中継する。
   * @param byteAddr 開始バイトアドレス
   * @param byteCount バイト数
   * @returns 読み出したバイト列
   */
  memRead?: (byteAddr: number, byteCount: number) => Promise<Uint8Array>;
  /**
   * メモリ書き込み（84h）を CPU ハンドシェイクへ中継する。
   * @param byteAddr 開始バイトアドレス
   * @param data 書き込むバイト列
   */
  memWrite?: (byteAddr: number, data: Uint8Array) => Promise<void>;
};

export type DebugHostOptions = {
  handlers: DebugHostHandlers;
  /** 省略時は DEBUG_TCP_PORT（テストは 0 でエフェメラル） */
  port?: number;
  /** 省略時は DEBUG_TCP_HOST */
  host?: string;
};

/**
 * PC（Cursor 拡張）からのバイナリ接続を受け、80h/81h/83h/84h を CPU ハンドシェイクへ中継する。
 */
export class DebugHost {
  private readonly handlers: DebugHostHandlers;
  private readonly listenPort: number;
  private readonly listenHost: string;
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();

  /**
   * @param options 中継ハンドラと待ち受け
   */
  constructor(options: DebugHostOptions) {
    this.handlers = options.handlers;
    this.listenPort = options.port ?? DEBUG_TCP_PORT;
    this.listenHost = options.host ?? DEBUG_TCP_HOST;
  }

  /**
   * TCP 待ち受けを開始する。
   * @returns 実際に bind したポート
   */
  listen(): Promise<number> {
    if (this.server) {
      const addr = this.server.address();
      if (addr && typeof addr === "object") return Promise.resolve(addr.port);
    }
    return new Promise((resolve, reject) => {
      const server = net.createServer((sock) => this.onConnection(sock));
      /** listen 前の bind 失敗を Promise に渡す */
      const onErr = (err: Error): void => {
        reject(err);
      };
      server.once("error", onErr);
      server.listen(this.listenPort, this.listenHost, () => {
        server.removeListener("error", onErr);
        server.on("error", (err: Error) => {
          getLogger("io").error("デバッグ TCP サーバエラー", {
            err: err.message,
          });
        });
        this.server = server;
        const addr = server.address();
        const port =
          addr && typeof addr === "object" ? addr.port : this.listenPort;
        getLogger("io").info("デバッグ TCP 待ち受け開始", {
          host: this.listenHost,
          port,
        });
        resolve(port);
      });
    });
  }

  /** 待ち受けと接続中ソケットを閉じる */
  async close(): Promise<void> {
    for (const s of this.sockets) {
      s.destroy();
    }
    this.sockets.clear();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    getLogger("io").info("デバッグ TCP 待ち受け終了");
  }

  /**
   * 1 接続の受信ループ。コマンド先頭で長さを決め、応答 1 バイトを返す。
   * @param sock クライアントソケット
   */
  private onConnection(sock: net.Socket): void {
    this.sockets.add(sock);
    getLogger("io").info("デバッグ TCP 接続", {
      remote: `${sock.remoteAddress}:${sock.remotePort}`,
    });
    let buf = Buffer.alloc(0);
    let busy = false;
    /** バッファに 1 フレーム分溜まったら中継して応答する */
    const pump = (): void => {
      if (busy) return;
      if (buf.length < 1) return;
      const need = debugPcNeededBytes(buf);
      if (need === null || buf.length < need) return;
      const frame = Uint8Array.from(buf.subarray(0, need));
      buf = buf.subarray(need);
      busy = true;
      void this.dispatch(frame)
        .then((reply) => {
          if (sock.destroyed) return;
          sock.write(reply);
        })
        .catch((e: unknown) => {
          getLogger("io").error("デバッグ TCP コマンド処理に失敗", {
            err: e instanceof Error ? e.message : String(e),
          });
          if (!sock.destroyed) sock.write(Uint8Array.from([RESPONSE_CODE.NG]));
        })
        .finally(() => {
          busy = false;
          pump();
        });
    };
    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      pump();
    });
    sock.on("close", () => {
      this.sockets.delete(sock);
    });
    sock.on("error", () => {
      this.sockets.delete(sock);
    });
  }

  /**
   * 1 フレームを解釈し、CPU ハンドシェイクの結果を待つ。
   * @param frame コマンドを含む受信バイト
   * @returns 応答（80h/81h/84h は 1 バイト。83h OK は status+長さ+データ）
   */
  private async dispatch(frame: Uint8Array): Promise<Uint8Array> {
    const set = parseAddrBreakSetFrame(frame);
    if (set) {
      if (!isAddrBreakSlot(set.slot)) {
        return Uint8Array.from([RESPONSE_CODE.NG]);
      }
      const payload = addrBreakSetPayload(frame);
      if (!payload) return Uint8Array.from([RESPONSE_CODE.NG]);
      getLogger("io").info("デバッグ 80h アドレスブレイク設定", {
        slot: set.slot,
        flags: set.flags,
        count: set.count,
        addr: `0x${set.addr.toString(16)}`,
      });
      const status = (await this.handlers.addrBreakSet(payload)) & 0xff;
      return Uint8Array.from([status]);
    }
    const slot = parseAddrBreakClrSlot(frame);
    if (slot !== null) {
      if (!isAddrBreakSlot(slot)) {
        return Uint8Array.from([RESPONSE_CODE.NG]);
      }
      getLogger("io").info("デバッグ 81h アドレスブレイク解除", { slot });
      const status = (await this.handlers.addrBreakClr(slot)) & 0xff;
      return Uint8Array.from([status]);
    }
    const rd = parseMemReadFrame(frame);
    if (rd) {
      if (!this.handlers.memRead) {
        return Uint8Array.from([RESPONSE_CODE.NG]);
      }
      if (rd.byteCount < 1 || rd.byteCount > DEBUG_MEM_MAX_BYTES) {
        return Uint8Array.from([RESPONSE_CODE.NG]);
      }
      getLogger("io").info("デバッグ 83h メモリ読み出し", {
        byteAddr: `0x${rd.byteAddr.toString(16)}`,
        byteCount: rd.byteCount,
      });
      const data = await this.handlers.memRead(rd.byteAddr, rd.byteCount);
      const m = data.byteLength >>> 0;
      const out = new Uint8Array(5 + m);
      out[0] = RESPONSE_CODE.OK;
      out[1] = (m >>> 24) & 0xff;
      out[2] = (m >>> 16) & 0xff;
      out[3] = (m >>> 8) & 0xff;
      out[4] = m & 0xff;
      out.set(data, 5);
      return out;
    }
    const wr = parseMemWriteFrame(frame);
    if (wr) {
      if (!this.handlers.memWrite) {
        return Uint8Array.from([RESPONSE_CODE.NG]);
      }
      if (wr.data.byteLength < 1 || wr.data.byteLength > DEBUG_MEM_MAX_BYTES) {
        return Uint8Array.from([RESPONSE_CODE.NG]);
      }
      getLogger("io").info("デバッグ 84h メモリ書き込み", {
        byteAddr: `0x${wr.byteAddr.toString(16)}`,
        byteCount: wr.data.byteLength,
      });
      await this.handlers.memWrite(wr.byteAddr, wr.data);
      return Uint8Array.from([RESPONSE_CODE.OK]);
    }
    return Uint8Array.from([RESPONSE_CODE.NG]);
  }
}
