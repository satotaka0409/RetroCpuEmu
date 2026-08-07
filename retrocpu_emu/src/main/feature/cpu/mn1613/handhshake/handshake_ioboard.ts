/**
 * 制御・I/O ボード側ハンドシェイク（TypeScript / HandShake.mdc）
 *
 * board/handshake から再エクスポートする。CPU 側はアセンブラ実装。
 */

import type { CpuIoSignals } from "../mn1613ioport";
import {
  DEFAULT_TIMEOUT_MS,
  INT_CAUSE_CODE,
  waitEna0Check,
  waitCondition,
} from "./handshake_type";

export class IoControlHandshake {
  /**
   * @param bus CPU と共有する制御信号／データ線
   * @param timeoutMs 各信号待ちのタイムアウト（ミリ秒）
   */
  constructor(
    private readonly bus: CpuIoSignals,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * IO→CPU 方向へ 1 フレーム送る（開始 → データ転送 → 完了）。
   * @param data 送信バイト列
   */
  async send(data: Uint8Array): Promise<void> {
    await this.initiateSend();
    await this.transferBytesToCpu(data);
    await this.finalizeSend();
  }

  /**
   * CPU→IO 方向のフレームを受け取る（転送長が既知の場合）。
   * @param length 受信バイト数
   * @returns 受信バイト列
   */
  async receive(length: number): Promise<Uint8Array> {
    await this.waitForCpuRequest();
    const data = await this.receiveBytesFromCpu(length);
    await this.finalizeReceive();
    return data;
  }

  /**
   * 先頭1バイトを見て残余長を決め、同一 ENA セッションでフレーム全体を受信する。
   * CPU→IO コマンド（コマンドで転送長が確定）向け。
   */
  async receiveFramed(
    remainingAfterFirst: (firstByte: number) => number,
  ): Promise<Uint8Array> {
    await this.waitForCpuRequest();
    const first = await this.receiveOneByteFromCpu();
    const rem = Math.max(0, remainingAfterFirst(first) | 0);
    const rest = rem > 0 ? await this.receiveBytesFromCpu(rem) : new Uint8Array(0);
    await this.finalizeReceive();
    const frame = new Uint8Array(1 + rest.length);
    frame[0] = first;
    frame.set(rest, 1);
    return frame;
  }

  /** CPU の REQ_0 を待って依頼を受理する（DACK=0 → ENA=1 → REQ_0=0 待ち） */
  private async waitForCpuRequest(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_REQ_0 === 1, this.timeoutMs);
    this.bus.HSHK_DACK = 0;
    this.bus.HSHK_ENA = 1;
    await waitCondition(() => this.bus.HSHK_REQ_0 === 0, this.timeoutMs);
  }

  /**
   * CPU から 1 バイト受け取る（DENA=1 待ち → 読取 → DACK ハンドシェイク）。
   * @returns 受信バイト
   */
  private async receiveOneByteFromCpu(): Promise<number> {
    await waitCondition(() => this.bus.HSHK_DENA === 1, this.timeoutMs);
    const byte = this.bus.HSHK_IN_DATA & 0xff;
    this.bus.HSHK_DACK = 1;
    await waitCondition(() => this.bus.HSHK_DENA === 0, this.timeoutMs);
    this.bus.HSHK_DACK = 0;
    return byte;
  }

  /**
   * CPU から指定バイト数を連続で受け取る。
   * @param length 受信バイト数
   * @returns 受信バイト列
   */
  private async receiveBytesFromCpu(length: number): Promise<Uint8Array> {
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = await this.receiveOneByteFromCpu();
    }
    return data;
  }

  /** ENA=0 にして受信完了を CPU へ通知する */
  private async finalizeReceive(): Promise<void> {
    this.bus.HSHK_ENA = 0;
  }

  /**
   * IO→CPU 送信を開始する。
   * ENA=0 を確認し、割り込み要因を HANDSHAKE にして REQ_1 で CPU へ依頼する。
   */
  private async initiateSend(): Promise<void> {
    await waitEna0Check(() => this.bus.HSHK_ENA === 0);
    await waitCondition(() => this.bus.INTERRUPT_BUSY === 0, this.timeoutMs);
    this.bus.HSHK_DENA = 0;
    this.bus.INT_CAUSE = INT_CAUSE_CODE.HANDSHAKE;
    this.bus.HSHK_REQ_1 = 1;
    await waitCondition(() => this.bus.HSHK_ENA === 1, this.timeoutMs);
    this.bus.HSHK_REQ_1 = 0;
  }

  /**
   * CPU へバイト列を 1 バイトずつ渡す（DENA / DACK の往復）。
   * @param data 送信バイト列
   */
  private async transferBytesToCpu(data: Uint8Array): Promise<void> {
    for (const byte of data) {
      this.bus.HSHK_OUT_DATA = byte & 0xff;
      this.bus.HSHK_DENA = 1;
      await waitCondition(() => this.bus.HSHK_DACK === 1, this.timeoutMs);
      this.bus.HSHK_DENA = 0;
      await waitCondition(() => this.bus.HSHK_DACK === 0, this.timeoutMs);
    }
  }

  /** CPU が ENA=0 にするのを待って送信完了とする */
  private async finalizeSend(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_ENA === 0, this.timeoutMs);
  }
}
