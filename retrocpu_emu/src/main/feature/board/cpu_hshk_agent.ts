/**
 * CPU ボード側のハンドシェイク代行（CPU→IO コマンドの取り込みと応答）
 * 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc（IO 0020〜0024）
 *
 * 実機では線でつながった 1階ボードが IO ポートの向こう側に居る。
 * エミュレータでは CPU ボード Worker がその線側を受け持ち、
 * ビットレベルのハンドシェイクでフレームを組み立ててから
 * IO ボード Worker へ転送し、返ってきた応答をそのまま線へ流す。
 */

import { CPU_PAYLOAD_REMAINING_SIZE } from "../cpu/mn1613/handhshake/command_cpu_to_io";
import { IoControlHandshake } from "../cpu/mn1613/handhshake/handshake_ioboard";
import {
  createHandshakeBus,
  DEFAULT_TIMEOUT_MS,
} from "../cpu/mn1613/handhshake/handshake_type";
import type { CpuIoSignals } from "../cpu/mn1613/mn1613ioport";

/**
 * REQ_0 待ちのポーリング間隔 (ms)。
 * CPU は REQ_0 を上げた後 ENA を待ち続けるため、検知が数 ms 遅れても支障はない。
 * 転送中は IoControlHandshake 側がより細かくポーリングする。
 */
const IDLE_POLL_MS = 2;

export type CpuHandshakeAgentOptions = {
  /**
   * 組み立てたフレームを IO ボードへ転送する。
   * @returns CPU へ返す応答バイト列（空なら応答なし）
   */
  forward: (frame: Uint8Array) => Promise<Uint8Array>;
  /** ハンドシェイク各段のタイムアウト (ms) */
  timeoutMs?: number;
  /** 転送 1 件ごとの通知（ログ用） */
  onTransaction?: (cmd: number, frame: Uint8Array, response: Uint8Array) => void;
  /** 転送失敗の通知（ログ用。ループは継続する） */
  onError?: (err: Error) => void;
};

export class CpuHandshakeAgent {
  /** CPU の IO ポート 0020〜0024 に見せる信号バス */
  readonly bus: CpuIoSignals;

  private readonly io: IoControlHandshake;
  private readonly options: CpuHandshakeAgentOptions;
  private serving = false;
  private servePromise: Promise<void> | null = null;
  private abortServe = false;

  /**
   * @param options フレーム転送関数、タイムアウト、通知コールバック
   */
  constructor(options: CpuHandshakeAgentOptions) {
    this.options = options;
    this.bus = createHandshakeBus();
    this.io = new IoControlHandshake(
      this.bus,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  }

  /**
   * 稼働中か。
   * @returns start() 済みで停止していなければ true
   */
  get isServing(): boolean {
    return this.serving;
  }

  /** CPU→IO 要求の受付ループを開始する（多重呼び出しは無視） */
  start(): void {
    if (this.serving) return;
    this.abortServe = false;
    this.serving = true;
    this.servePromise = this.serveLoop().finally(() => {
      this.serving = false;
      this.servePromise = null;
    });
  }

  /** 受付ループを止める（REQ_0 待ちのスライスが明けるまで待つ） */
  async stop(): Promise<void> {
    if (!this.serving) return;
    this.abortServe = true;
    await this.servePromise?.catch(() => undefined);
  }

  /**
   * CPU→IO を 1 トランザクション処理する（受信 → 転送 → 応答送信）。
   * @returns IO ボードから返った応答バイト列
   */
  async handleOneRequest(): Promise<Uint8Array> {
    const frame = await this.io.receiveFramed(
      (cmd) => CPU_PAYLOAD_REMAINING_SIZE[cmd] ?? 0,
    );
    const response = await this.options.forward(frame);
    this.options.onTransaction?.(frame[0] ?? 0, frame, response);
    if (response.length > 0) {
      await this.io.send(response);
    }
    return response;
  }

  /**
   * REQ_0 を待って 1 件ずつ処理し続ける。
   * タイムアウトと ENA0 チェック失敗は継続、それ以外は onError に通知して継続する。
   */
  private async serveLoop(): Promise<void> {
    while (!this.abortServe) {
      await this.waitForRequest();
      if (this.abortServe) return;
      try {
        await this.handleOneRequest();
      } catch (err) {
        if (this.abortServe) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("timeout") || msg.includes("ENA0")) {
          continue;
        }
        this.options.onError?.(err instanceof Error ? err : new Error(msg));
      }
    }
  }

  /** REQ_0 が立つか停止要求が来るまで、IDLE_POLL_MS 間隔で待つ */
  private waitForRequest(): Promise<void> {
    return new Promise((resolve) => {
      /** 条件を満たせば resolve、まだなら次のポーリングを予約する */
      const check = (): void => {
        if (this.abortServe || this.bus.HSHK_REQ_0 === 1) {
          resolve();
          return;
        }
        setTimeout(check, IDLE_POLL_MS);
      };
      check();
    });
  }
}
