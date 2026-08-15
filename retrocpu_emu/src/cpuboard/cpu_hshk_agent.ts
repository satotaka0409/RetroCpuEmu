/**
 * CPU Worker 上のハンドシェイク橋（MN1613 の IO ポート ↔ IO Worker RPC）
 * 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc（IO 0020〜0024）
 *
 * CPU 側プロトコルはアセンブラ（handshake_common.asm / handshake_read_memory.asm）。
 * - CPU→IO: REQ_0 を受けフレームを IO Worker へ転送し、応答を同じ線へ返す
 * - IO→CPU: 13h/14h を REQ_1 + IRQ2 でモニタへ渡し、線上でデータ交換する
 * Worker 間で GPIO を共有できないための橋。
 */

import { CPU_PAYLOAD_REMAINING_SIZE } from "../ioboard/handshake/command_cpu_to_io";
import { wireHshkReq1ToIrq2 } from "../ioboard/handshake/io_board_mock";
import { IoControlHandshake } from "../shared/handshake/handshake_ioboard";
import {
  createHandshakeBus,
  DEFAULT_TIMEOUT_MS,
} from "../shared/handshake/handshake_type";
import type { CpuIoSignals } from "./mn1613/mn1613ioport";

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
  /** CPU→IO 受信ループと IO→CPU（13h/14h）を直列化する */
  private busLock: Promise<void> = Promise.resolve();

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
    wireHshkReq1ToIrq2(this.bus);
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
   * IO→CPU メモリ読み出し（13h）。DMA ではない。
   * @param byteAddr 読み出し開始バイトアドレス
   * @param byteCount 読み出しバイト数
   * @returns 読み出したバイト列
   */
  memRead(byteAddr: number, byteCount: number): Promise<Uint8Array> {
    return this.withBusLock(() => this.io.memRead(byteAddr, byteCount));
  }

  /**
   * IO→CPU メモリ書き込み（14h）。DMA ではない。
   * @param byteAddr 書き込み開始バイトアドレス
   * @param data 書き込むバイト列
   */
  memWrite(byteAddr: number, data: Uint8Array): Promise<void> {
    return this.withBusLock(() => this.io.memWrite(byteAddr, data));
  }

  /**
   * IO→CPU アドレス／IO ブレイク設定（10h）。
   * @param payload コマンド除く 9 バイト
   * @returns CPU が返した status（OK/NG）
   */
  addrBreakSet(payload: Uint8Array): Promise<number> {
    return this.withBusLock(() => this.io.addrBreakSet(payload));
  }

  /**
   * IO→CPU アドレス／IO ブレイク解除（11h）。
   * @param slot ブレイク設定番号（0–7）
   * @returns CPU が返した status（OK/NG）
   */
  addrBreakClr(slot: number): Promise<number> {
    return this.withBusLock(() => this.io.addrBreakClr(slot));
  }

  /**
   * バス操作を直列化する（CPU→IO 受信と IO→CPU 送信が混ざらないようにする）。
   * @param fn バスを使う処理
   * @returns fn の結果
   */
  private withBusLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busLock.then(fn, fn);
    this.busLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * CPU→IO を 1 トランザクション処理する（受信 → 転送 → 応答送信）。
   * @returns IO ボードから返った応答バイト列
   */
  async handleOneRequest(): Promise<Uint8Array> {
    return this.withBusLock(async () => {
      const frame = await this.io.receiveFramed(
        (cmd) => CPU_PAYLOAD_REMAINING_SIZE[cmd] ?? 0,
      );
      const response = await this.options.forward(frame);
      this.options.onTransaction?.(frame[0] ?? 0, frame, response);
      if (response.length > 0) {
        await this.io.send(response);
      }
      return response;
    });
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
