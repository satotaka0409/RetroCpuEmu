/**
 * IO → CPU ボードリンククライアント（DMA + ハンドシェイク RPC）
 */

import type { MessagePort } from "node:worker_threads";
import {
  CMD_IO_TO_CPU,
  type BoardLinkRequest,
  type BoardLinkResponse,
  type CpuToIoFrameRequest,
  type CpuToIoFrameResponse,
} from "../shared/board_link";

type Pending = {
  resolve: (data?: ArrayBuffer) => void;
  reject: (err: Error) => void;
};

/** CPU→IO コマンドフレームの処理関数（IO ボード側のコマンド解釈） */
export type CpuToIoFrameHandler = (
  frame: Uint8Array,
) => Uint8Array | Promise<Uint8Array>;

export class BoardLinkClient {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private port: MessagePort | null = null;
  private onCpuFrame: CpuToIoFrameHandler | null = null;

  /**
   * CPU ボードとつながる MessagePort を接続する。既存ポートは閉じる。
   * @param port CPU Worker と対になる MessagePort
   */
  attach(port: MessagePort): void {
    this.port?.close();
    this.port = port;
    port.on("message", (msg: BoardLinkResponse | CpuToIoFrameRequest) => {
      if (msg?.type === "cpuio:frame") {
        void this.serveCpuFrame(port, msg);
        return;
      }
      if (!msg || msg.type !== "link:result") return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error ?? "board link failed"));
    });
    port.start();
  }

  /**
   * CPU→IO コマンドフレームの処理関数を登録する。
   * 未登録のままフレームが届いた場合は NG 応答を返す。
   * @param handler フレームを解釈して応答バイト列を返す関数
   */
  setCpuToIoFrameHandler(handler: CpuToIoFrameHandler | null): void {
    this.onCpuFrame = handler;
  }

  /**
   * 届いた CPU→IO フレームを処理して応答を返す。
   * @param port 応答先ポート
   * @param req 受信したフレーム転送要求
   */
  private async serveCpuFrame(
    port: MessagePort,
    req: CpuToIoFrameRequest,
  ): Promise<void> {
    if (!this.onCpuFrame) {
      const res: CpuToIoFrameResponse = {
        type: "cpuio:result",
        id: req.id,
        ok: false,
        error: "cpu to io frame handler not set",
      };
      port.postMessage(res);
      return;
    }
    try {
      const response = await this.onCpuFrame(new Uint8Array(req.frame));
      const copy = new Uint8Array(response.byteLength);
      copy.set(response);
      const ab = copy.buffer as ArrayBuffer;
      const res: CpuToIoFrameResponse = {
        type: "cpuio:result",
        id: req.id,
        ok: true,
        response: ab,
      };
      port.postMessage(res, [ab]);
    } catch (e) {
      const res: CpuToIoFrameResponse = {
        type: "cpuio:result",
        id: req.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
      port.postMessage(res);
    }
  }

  /**
   * DMA で CPU ボードの RAM へ書き込む（書き込み専用。読み込み API は無い）。
   * HALT / RESET 時のみ有効。
   * @param byteAddr 書き込み先バイトアドレス
   * @param data 書き込むバイト列（内部でコピーして転送する）
   */
  async writeBytes(byteAddr: number, data: Uint8Array): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const ab = copy.buffer as ArrayBuffer;
    const req: BoardLinkRequest = {
      type: "dma:writeBytes",
      id,
      byteAddr: byteAddr >>> 0,
      data: ab,
    };
    await this.send(port, req, [ab]);
  }

  /**
   * ハンドシェイク MEM_READ (0x13) でメモリを読む（DMA ではない。DMA に read は無い）。
   * @param wordAddr 読み出し開始ワードアドレス
   * @param byteCount 読み出しバイト数
   * @returns 読み出したバイト列
   */
  async memReadBytes(wordAddr: number, byteCount: number): Promise<Uint8Array> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.MEM_READ,
      wordAddr: wordAddr >>> 0,
      byteCount: byteCount >>> 0,
    };
    const data = await this.send(port, req);
    return new Uint8Array(data ?? new ArrayBuffer(0));
  }

  /**
   * ハンドシェイク MEM_WRITE (0x14) でメモリへ書く。
   * @param wordAddr 書き込み開始ワードアドレス
   * @param data 書き込むバイト列
   */
  async memWriteBytes(wordAddr: number, data: Uint8Array): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const ab = copy.buffer as ArrayBuffer;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.MEM_WRITE,
      wordAddr: wordAddr >>> 0,
      data: ab,
    };
    await this.send(port, req, [ab]);
  }

  /**
   * ハンドシェイク EXEC (0x12) で指定アドレスから実行させる。
   * @param wordAddr 実行開始ワードアドレス
   */
  async exec(wordAddr: number): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.EXEC,
      wordAddr: wordAddr >>> 0,
    };
    await this.send(port, req);
  }

  /**
   * ハンドシェイク 10h でメモリ／IO ブレイクを設定する。
   * CPU の応答を待って status を返す（中継。retrocpu_debug.mdc）。
   * @param payload コマンド除く 9 バイト（slot, flags, count, addr32 BE, data16 BE）
   * @returns OK=0 / NG=1。リンク失敗時も NG
   */
  async addrBreakSet(payload: Uint8Array): Promise<number> {
    const port = this.requirePort();
    const id = this.nextId++;
    const copy = new Uint8Array(payload.byteLength);
    copy.set(payload);
    const ab = copy.buffer as ArrayBuffer;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.BREAK_MEM_IO_SET,
      payload: ab,
    };
    try {
      const data = await this.send(port, req, [ab]);
      return data ? new Uint8Array(data)[0]! & 0xff : 0x01;
    } catch {
      return 0x01;
    }
  }

  /**
   * ハンドシェイク 11h でメモリ／IO ブレイクを解除する。
   * @param slot ブレイク設定番号（0–3）
   * @returns OK=0 / NG=1。リンク失敗時も NG
   */
  async addrBreakClr(slot: number): Promise<number> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = {
      type: "hshk",
      id,
      cmd: CMD_IO_TO_CPU.BREAK_MEM_IO_CLR,
      slot: slot & 0xff,
    };
    try {
      const data = await this.send(port, req);
      return data ? new Uint8Array(data)[0]! & 0xff : 0x01;
    } catch {
      return 0x01;
    }
  }

  /**
   * CPU の HALT ピン相当を操作する。
   * @param halt true で停止、false で実行再開
   */
  async setHalt(halt: boolean): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = { type: "cpu:setHalt", id, halt };
    await this.send(port, req);
  }

  /**
   * CPU へ割り込みを要求する（IO ボード発の割り込み。要因は INT_CAUSE に載る）。
   * @param level 割り込みレベル（MN1613 は 0〜2。タイマー・ハンドシェイクは 2）
   * @param cause 割り込み要因（INT_CAUSE_CODE。タイマーは 0）
   */
  async raiseInterrupt(level: 0 | 1 | 2, cause: number): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = { type: "cpu:irq", id, level, cause };
    await this.send(port, req);
  }

  /**
   * CPU にリセットパルスを送る（HLT 解除込み。F7 / 電源投入の最終段）。
   * @param resetVectorWord IO:0000 へ積むベクタ表先頭（ワードアドレス、任意。STR/IC は表+2/+3）
   */
  async pulseReset(resetVectorWord?: number): Promise<void> {
    const port = this.requirePort();
    const id = this.nextId++;
    const req: BoardLinkRequest = {
      type: "cpu:pulseReset",
      id,
      resetVectorWord:
        typeof resetVectorWord === "number"
          ? resetVectorWord & 0xffff
          : undefined,
    };
    await this.send(port, req);
  }

  /**
   * リクエストを送り、同じ id の応答が返るまで待つ。
   * @param port 送信先ポート
   * @param req リクエスト（id は呼び出し側で採番済み）
   * @param transfer 所有権を移す ArrayBuffer
   * @returns 応答に含まれるデータ（無い場合は undefined）
   */
  private send(
    port: MessagePort,
    req: BoardLinkRequest,
    transfer?: ArrayBuffer[],
  ): Promise<ArrayBuffer | undefined> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, {
        resolve: (data) => resolve(data),
        reject,
      });
      if (transfer) port.postMessage(req, transfer);
      else port.postMessage(req);
    });
  }

  /**
   * 接続済みポートを返す。
   * @returns MessagePort
   * @throws attach() 前に呼ばれた場合
   */
  private requirePort(): MessagePort {
    if (!this.port) throw new Error("board link port not attached");
    return this.port;
  }
}
