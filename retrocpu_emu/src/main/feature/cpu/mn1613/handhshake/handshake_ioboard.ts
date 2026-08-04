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
  constructor(
    private readonly bus: CpuIoSignals,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async send(data: Uint8Array): Promise<void> {
    await this.initiateSend();
    await this.transferBytesToCpu(data);
    await this.finalizeSend();
  }

  async receive(length: number): Promise<Uint8Array> {
    await this.waitForCpuRequest();
    const data = await this.receiveBytesFromCpu(length);
    await this.finalizeReceive();
    return data;
  }

  private async waitForCpuRequest(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_REQ_0 === 1, this.timeoutMs);
    this.bus.HSHK_DACK = 0;
    this.bus.HSHK_ENA = 1;
    await waitCondition(() => this.bus.HSHK_REQ_0 === 0, this.timeoutMs);
  }

  private async receiveBytesFromCpu(length: number): Promise<Uint8Array> {
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      await waitCondition(() => this.bus.HSHK_DENA === 1, this.timeoutMs);
      data[i] = this.bus.HSHK_IN_DATA & 0xff;
      this.bus.HSHK_DACK = 1;
      await waitCondition(() => this.bus.HSHK_DENA === 0, this.timeoutMs);
      this.bus.HSHK_DACK = 0;
    }
    return data;
  }

  private async finalizeReceive(): Promise<void> {
    this.bus.HSHK_ENA = 0;
  }

  private async initiateSend(): Promise<void> {
    await waitEna0Check(() => this.bus.HSHK_ENA === 0);
    await waitCondition(() => this.bus.INTERRUPT_BUSY === 0, this.timeoutMs);
    this.bus.HSHK_DENA = 0;
    this.bus.INT_CAUSE = INT_CAUSE_CODE.HANDSHAKE;
    this.bus.HSHK_REQ_1 = 1;
    await waitCondition(() => this.bus.HSHK_ENA === 1, this.timeoutMs);
    this.bus.HSHK_REQ_1 = 0;
  }

  private async transferBytesToCpu(data: Uint8Array): Promise<void> {
    for (const byte of data) {
      this.bus.HSHK_OUT_DATA = byte & 0xff;
      this.bus.HSHK_DENA = 1;
      await waitCondition(() => this.bus.HSHK_DACK === 1, this.timeoutMs);
      this.bus.HSHK_DENA = 0;
      await waitCondition(() => this.bus.HSHK_DACK === 0, this.timeoutMs);
    }
  }

  private async finalizeSend(): Promise<void> {
    await waitCondition(() => this.bus.HSHK_ENA === 0, this.timeoutMs);
  }
}
