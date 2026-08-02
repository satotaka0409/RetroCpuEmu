/**
 * レトロCPUボード側ハンドシェイク実装
 *
 * HandShake.md の仕様に基づき、レトロCPUボード側の
 * 送信（CPU -> I/O）・受信（I/O -> CPU）を実装する。
 *
 * 送信フロー（initiateSend → transferBytesToIo → finalizeSend）:
 *   1. HSHK_ACK=0 チェック（50us～100us ランダム × 最大10回）
 *   2. HSHK_DENA=0 初期化
 *   3. HSHK_REQ_0=1 セット → I/O 側に割り込み発生
 *   4. HSHK_ACK=1 待機（I/O 側が依頼受理）
 *   5. HSHK_REQ_0=0 セット（ACK=1 確認後）
 *   6. HSHK_DATA セット → HSHK_DENA トグル → HSHK_DACK トグル待機（1バイトずつ繰り返し）
 *   7. HSHK_DENA=0 セット、HSHK_ACK=0 待機（完了）
 *
 * 受信フロー（waitForIoRequest → receiveBytesFromIo → finalizeReceive）:
 *   1. HSHK_REQ_1=1 待機（I/O からの割り込み）
 *   2. INT_CAUSE=2（ハンドシェイク）確認
 *   3. HSHK_DACK=0 初期化、HSHK_ACK=1 セット（依頼受理）
 *   4. HSHK_REQ_1=0 待機（I/O 側が REQ_1 を 0 に戻す）
 *   5. HSHK_ACK=0 セット（初期化完了）
 *   6. HSHK_DENA トグル待機 → HSHK_DATA 読み取り → HSHK_DACK トグル（1バイトずつ繰り返し）
 *   7. HSHK_DENA=0 待機、HSHK_DACK=0 / HSHK_ACK=0 セット（完了）
 */

import type { CpuIoSignals } from "../cpu/mn1613ioport";
import {
  DEFAULT_TIMEOUT_MS,
  INT_CAUSE_CODE,
  waitAck0Check,
  waitCondition,
} from "./handshake_type";

export class RetroCpuHandshake {
  constructor(
    private readonly bus: CpuIoSignals,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  // ─────────────────────────────────────────────
  // 公開 API
  // ─────────────────────────────────────────────

  /**
   * CPU -> I/O 方向でバイト列を送信する。
   * @param data 送信バイト列
   */
  async send(data: Uint8Array): Promise<void> {
    await this.initiateSend();
    await this.transferBytesToIo(data);
    await this.finalizeSend();
  }

  /**
   * I/O -> CPU 方向のデータを受信する。
   * HSHK_REQ_1 が 1 になるまで待機してから受信を開始する。
   * @param length 受信バイト数
   * @returns 受信バイト列
   */
  async receive(length: number): Promise<Uint8Array> {
    await this.waitForIoRequest();
    const data = await this.receiveBytesFromIo(length);
    await this.finalizeReceive();
    return data;
  }

  // ─────────────────────────────────────────────
  // 送信（CPU -> I/O）内部処理
  // ─────────────────────────────────────────────

  /** ハンドシェイク開始：初期化シーケンス（HandShake.md CPU→IO 起動シーケンス準拠） */
  private async initiateSend(): Promise<void> {
    // HSHK_ACK 0チェック: 50us～100us（ランダム）× 最大10回
    await waitAck0Check(() => this.bus.HSHK_ACK === 0);

    // HSHK_DENA を 0 に初期化
    this.bus.HSHK_DENA = 0;

    // HSHK_REQ_0=1 → I/O 側に割り込み発生
    this.bus.HSHK_REQ_0 = 1;

    // HSHK_ACK が 1 になるまで待機（I/O 側が依頼を受理）
    await waitCondition(() => this.bus.HSHK_ACK === 1, this.timeoutMs);

    // ACK=1 を確認してから HSHK_REQ_0=0（仕様: ACK=1後に初期化）
    this.bus.HSHK_REQ_0 = 0;

    // I/O 側が HSHK_ACK=0 にリセットするまで待機（データ転送開始前の初期化完了）
    await waitCondition(() => this.bus.HSHK_ACK === 0, this.timeoutMs);
  }

  /**
   * データ転送：HSHK_DENA/HSHK_DACK をトリガーとして 1 バイトずつ送信する。
   * HSHK_DENA と HSHK_DACK は 0->1, 1->0 を交互に繰り返す。
   */
  private async transferBytesToIo(data: Uint8Array): Promise<void> {
    let denaNext: 0 | 1 = 1; // 最初のトグルは 0->1

    for (const byte of data) {
      // データをセット
      this.bus.HSHK_DATA[0] = byte;

      // HSHK_DENA をトグル
      this.bus.HSHK_DENA = denaNext;

      // HSHK_DACK が同じ値になるまで待機（I/O 側がデータを取り込んだ）
      const dackExpected = denaNext;
      await waitCondition(
        () => this.bus.HSHK_DACK === dackExpected,
        this.timeoutMs,
      );

      denaNext = denaNext === 1 ? 0 : 1;
    }
  }

  /** ハンドシェイク完了：完了シーケンス */
  private async finalizeSend(): Promise<void> {
    // HSHK_DENA を 0 にセット（完了処理）
    this.bus.HSHK_DENA = 0;

    // I/O 側が HSHK_ACK を 0 にセットするまで待機
    await waitCondition(() => this.bus.HSHK_ACK === 0, this.timeoutMs);
  }

  // ─────────────────────────────────────────────
  // 受信（I/O -> CPU）内部処理
  // ─────────────────────────────────────────────

  /** 割り込み待機：I/O からの HSHK_REQ_1 を受理して初期化シーケンスを実行
   * （HandShake.md I/O→CPU 起動シーケンス CPU側準拠）
   */
  private async waitForIoRequest(): Promise<void> {
    // HSHK_REQ_1 が 1 になるまで待機（I/O からの割り込み）
    await waitCondition(() => this.bus.HSHK_REQ_1 === 1, this.timeoutMs);

    // INT_CAUSE がハンドシェイク(2) であることを確認
    if (this.bus.INT_CAUSE !== INT_CAUSE_CODE.HANDSHAKE) {
      throw new Error(
        `unexpected INT_CAUSE: ${this.bus.INT_CAUSE} (expected ${INT_CAUSE_CODE.HANDSHAKE})`,
      );
    }

    // HSHK_DACK を 0 に初期化（仕様: ACK=1 セット前に DACK=0 初期化）
    this.bus.HSHK_DACK = 0;

    // HSHK_ACK を 1 にセット（依頼受理を通知）
    this.bus.HSHK_ACK = 1;

    // I/O 側が HSHK_REQ_1 を 0 にセットするまで待機（初期化）
    await waitCondition(() => this.bus.HSHK_REQ_1 === 0, this.timeoutMs);

    // HSHK_ACK を 0 にセット（データ転送開始前の初期化完了）
    this.bus.HSHK_ACK = 0;
  }

  /**
   * データ受信：HSHK_DENA/HSHK_DACK をトリガーとして 1 バイトずつ受信する。
   * HSHK_DENA と HSHK_DACK は 0->1, 1->0 を交互に繰り返す。
   */
  private async receiveBytesFromIo(length: number): Promise<Uint8Array> {
    const data = new Uint8Array(length);
    let denaExpected: 0 | 1 = 1; // 最初のトグルは 0->1

    for (let i = 0; i < length; i++) {
      // HSHK_DENA がトグルするまで待機（I/O 側がデータをセット）
      await waitCondition(
        () => this.bus.HSHK_DENA === denaExpected,
        this.timeoutMs,
      );

      // データを取り込む
      data[i] = this.bus.HSHK_DATA[0]!;

      // HSHK_DACK をトグル（取り込み完了を通知）
      this.bus.HSHK_DACK = denaExpected;

      denaExpected = denaExpected === 1 ? 0 : 1;
    }

    return data;
  }

  /** ハンドシェイク完了：完了シーケンス */
  private async finalizeReceive(): Promise<void> {
    // I/O 側が HSHK_DENA を 0 にセットするまで待機
    await waitCondition(() => this.bus.HSHK_DENA === 0, this.timeoutMs);

    // HSHK_DACK / HSHK_ACK を 0 にセット（完了処理）
    this.bus.HSHK_DACK = 0;
    this.bus.HSHK_ACK = 0;
  }
}
