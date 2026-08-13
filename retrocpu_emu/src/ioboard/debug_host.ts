/**
 * IO ボード側のデバッグ TCP サーバ（PC＝クライアントがつなぐ）。
 * 根拠: retrocpu_debug.mdc（バイナリ、コマンド番号はハンドシェイクと同じ）。
 * 当面はアドレス／IO ブレイク設定（40h）と解除（41h）のみ。
 */

import net from "node:net";
import { getLogger } from "../log/logger";
import {
  addrBreakSetPayload,
  debugPcFrameLength,
  isAddrBreakSlot,
  parseAddrBreakClrSlot,
  parseAddrBreakSetFrame,
} from "./debug_addr_break";
import { RESPONSE_CODE } from "../shared/handshake/handshake_type";

/** 製品の待ち受けポート（ベタ書き。PC 側がつなぎに来る） */
export const DEBUG_TCP_PORT = 29000;

/** 待ち受けアドレス。WSL 上のエミュへホスト PC からつなぐため全インタフェース */
export const DEBUG_TCP_HOST = "0.0.0.0";

/** CPU への 40h/41h 中継（ハンドシェイク結果を待って status を返す） */
export type DebugHostHandlers = {
  /**
   * アドレス／IO ブレイク設定（40h）を CPU へ中継する。
   * @param payload コマンド除く 9 バイト
   * @returns OK=0 / NG=1
   */
  addrBreakSet: (payload: Uint8Array) => Promise<number>;
  /**
   * アドレス／IO ブレイク解除（41h）を CPU へ中継する。
   * @param slot 設定番号 0–5
   * @returns OK=0 / NG=1
   */
  addrBreakClr: (slot: number) => Promise<number>;
};

export type DebugHostOptions = {
  handlers: DebugHostHandlers;
  /** 省略時は DEBUG_TCP_PORT（テストは 0 でエフェメラル） */
  port?: number;
  /** 省略時は DEBUG_TCP_HOST */
  host?: string;
};

/**
 * PC（Cursor 拡張）からのバイナリ接続を受け、40h/41h を CPU ハンドシェイクへ中継する。
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
          getLogger("io").error("デバッグ TCP サーバエラー", { err: err.message });
        });
        this.server = server;
        const addr = server.address();
        const port = addr && typeof addr === "object" ? addr.port : this.listenPort;
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
      const need = debugPcFrameLength(buf[0]!);
      if (buf.length < need) return;
      const frame = Uint8Array.from(buf.subarray(0, need));
      buf = buf.subarray(need);
      busy = true;
      void this.dispatch(frame)
        .then((status) => {
          if (!sock.destroyed) sock.write(Uint8Array.from([status & 0xff]));
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
   * @returns OK / NG
   */
  private async dispatch(frame: Uint8Array): Promise<number> {
    const set = parseAddrBreakSetFrame(frame);
    if (set) {
      if (!isAddrBreakSlot(set.slot)) return RESPONSE_CODE.NG;
      const payload = addrBreakSetPayload(frame);
      if (!payload) return RESPONSE_CODE.NG;
      getLogger("io").info("デバッグ 40h アドレスブレイク設定", {
        slot: set.slot,
        flags: set.flags,
        count: set.count,
        addr: `0x${set.addr.toString(16)}`,
      });
      return (await this.handlers.addrBreakSet(payload)) & 0xff;
    }
    const slot = parseAddrBreakClrSlot(frame);
    if (slot !== null) {
      if (!isAddrBreakSlot(slot)) return RESPONSE_CODE.NG;
      getLogger("io").info("デバッグ 41h アドレスブレイク解除", { slot });
      return (await this.handlers.addrBreakClr(slot)) & 0xff;
    }
    return RESPONSE_CODE.NG;
  }
}
