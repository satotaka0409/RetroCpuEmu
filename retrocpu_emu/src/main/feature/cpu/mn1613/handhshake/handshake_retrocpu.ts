/**
 * レトロCPUボード側ハンドシェイク（HandShake.mdc 新信号）の TypeScript 参照実装。
 *
 * 製品パスの CPU 側は MN1613 アセンブラ:
 *   retrocpu_boot_monitor/mn1613/src/handshake/handshake_common.asm
 * 本クラスはプロトコル単体テスト用に残す。
 *
 * HSHK_ENA / HSHK_IN_DATA / HSHK_OUT_DATA
 * 1バイト: DENA 0→1 → DACK 0→1 → DENA 1→0 → DACK 1→0
 */

import type { CpuIoSignals } from "../mn1613ioport";
import {
  DEFAULT_TIMEOUT_MS,
  INT_CAUSE_CODE,
  waitEna0Check,
  waitCondition,
} from "./handshake_type";

export class RetroCpuHandshake {
  /**
   * @param bus IO ボードと共有する制御信号／データ線
   * @param timeoutMs 各信号待ちのタイムアウト（ミリ秒）
   */
  constructor(
    private readonly bus: CpuIoSignals,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * CPU→IO 方向へ 1 フレーム送る（開始 → データ転送 → 完了）。
   * @param data 送信バイト列
   */
  async send(data: Uint8Array): Promise<void> {
    await this.initiateSend();
    await this.transferBytesToIo(data);
    await this.finalizeSend();
  }

  /**
   * IO→CPU 方向のフレームを受け取る。
   * @param length 受信バイト数
   * @returns 受信バイト列
   */
  async receive(length: number): Promise<Uint8Array> {
    await this.waitForIoRequest();
    const data = await this.receiveBytesFromIo(length);
    await this.finalizeReceive();
    return data;
  }

  /** CPU→IO 送信を開始する（ENA=0 確認 → DENA=0 → REQ_0=1 → ENA=1 待ち） */
  private async initiateSend(): Promise<void> {
    await waitEna0Check(() => this.bus.HSHK_ENA === 0);
    this.bus.HSHK_DENA = 0;
    this.bus.HSHK_REQ_0 = 1;
    await waitCondition(() => this.bus.HSHK_ENA === 1, this.timeoutMs);
    this.bus.HSHK_REQ_0 = 0;
  }

  /**
   * IO へバイト列を 1 バイトずつ渡す（DENA / DACK の往復）。
   * @param data 送信バイト列
   */
  private async transferBytesToIo(data: Uint8Array): Promise<void> {
    for (const byte of data) {
      this.bus.HSHK_IN_DATA = byte & 0xff;
      this.bus.HSHK_DENA = 1;
      await waitCondition(() => this.bus.HSHK_DACK === 1, this.timeoutMs);
      this.bus.HSHK_DENA = 0;
      await waitCondition(() => this.bus.HSHK_DACK === 0, this.timeoutMs);
    }
  }

  /** IO が ENA=0 にするのを待って送信完了とする */
  private async finalizeSend(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_ENA === 0, this.timeoutMs);
  }

  /**
   * IO の REQ_1 を待って依頼を受理する（レベル2割り込み相当）。
   * @throws 割り込み要因がハンドシェイク以外だった場合
   */
  private async waitForIoRequest(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_REQ_1 === 1, this.timeoutMs);
    if (this.bus.INT_CAUSE !== INT_CAUSE_CODE.HANDSHAKE) {
      throw new Error(
        `unexpected INT_CAUSE: ${this.bus.INT_CAUSE} (expected ${INT_CAUSE_CODE.HANDSHAKE})`,
      );
    }
    this.bus.HSHK_DACK = 0;
    this.bus.HSHK_ENA = 1;
    await waitCondition(() => this.bus.HSHK_REQ_1 === 0, this.timeoutMs);
  }

  /**
   * IO から指定バイト数を連続で受け取る。
   * @param length 受信バイト数
   * @returns 受信バイト列
   */
  private async receiveBytesFromIo(length: number): Promise<Uint8Array> {
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      await waitCondition(() => this.bus.HSHK_DENA === 1, this.timeoutMs);
      data[i] = this.bus.HSHK_OUT_DATA & 0xff;
      this.bus.HSHK_DACK = 1;
      await waitCondition(() => this.bus.HSHK_DENA === 0, this.timeoutMs);
      this.bus.HSHK_DACK = 0;
    }
    return data;
  }

  /** ENA=0 にして受信完了を IO へ通知する */
  private async finalizeReceive(): Promise<void> {
    this.bus.HSHK_ENA = 0;
  }
}
