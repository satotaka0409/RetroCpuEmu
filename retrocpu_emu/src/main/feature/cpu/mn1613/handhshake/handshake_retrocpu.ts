/**
 * レトロCPUボード側ハンドシェイク（HandShake.mdc 新信号）の TypeScript 参照実装。
 *
 * 製品パスの CPU 側は MN1613 アセンブラ:
 *   cursor_expand/monitor/mn1613/src/handshake/handshake_common.asm
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
  constructor(
    private readonly bus: CpuIoSignals,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async send(data: Uint8Array): Promise<void> {
    await this.initiateSend();
    await this.transferBytesToIo(data);
    await this.finalizeSend();
  }

  async receive(length: number): Promise<Uint8Array> {
    await this.waitForIoRequest();
    const data = await this.receiveBytesFromIo(length);
    await this.finalizeReceive();
    return data;
  }

  private async initiateSend(): Promise<void> {
    await waitEna0Check(() => this.bus.HSHK_ENA === 0);
    this.bus.HSHK_DENA = 0;
    this.bus.HSHK_REQ_0 = 1;
    await waitCondition(() => this.bus.HSHK_ENA === 1, this.timeoutMs);
    this.bus.HSHK_REQ_0 = 0;
  }

  private async transferBytesToIo(data: Uint8Array): Promise<void> {
    for (const byte of data) {
      this.bus.HSHK_IN_DATA = byte & 0xff;
      this.bus.HSHK_DENA = 1;
      await waitCondition(() => this.bus.HSHK_DACK === 1, this.timeoutMs);
      this.bus.HSHK_DENA = 0;
      await waitCondition(() => this.bus.HSHK_DACK === 0, this.timeoutMs);
    }
  }

  private async finalizeSend(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_ENA === 0, this.timeoutMs);
  }

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

  private async finalizeReceive(): Promise<void> {
    this.bus.HSHK_ENA = 0;
  }
}
