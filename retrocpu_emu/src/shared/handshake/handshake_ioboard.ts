/**
 * 制御・I/O ボード側ハンドシェイク（TypeScript / HandShake.mdc）
 *
 * board/handshake から再エクスポートする。CPU 側はアセンブラ実装。
 */

import type { CpuIoSignals } from "../../cpuboard/mn1613/mn1613ioport";
import {
  calcBlockChecksum,
  ADDR_BREAK_SET_PAYLOAD_LEN,
  ADDR_BREAK_SET_FRAME_LEN,
  CMD_IO_TO_CPU,
  DEFAULT_TIMEOUT_MS,
  HSHK_MEM_BLOCK,
  HSHK_MEM_RETRY_MAX,
  INT_CAUSE_CODE,
  RESPONSE_CODE,
  u32be,
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
   * IO→CPU を送ったあと同一 ENA セッションで CPU→IO 応答を受け取る。
   * 応答後に IO→CPU を足す場合は `thenToCpu` を使う。
   * @param toCpu IO→CPU 先頭バイト列（コマンド含む）
   * @param fromCpu CPU→IO で待つバイト数（0 なら受信しない）
   * @param thenToCpu 応答後に追加する IO→CPU（省略可）
   * @returns CPU→IO で受け取ったバイト列
   */
  async sendReceive(
    toCpu: Uint8Array,
    fromCpu: number,
    thenToCpu?: Uint8Array,
  ): Promise<Uint8Array> {
    await this.initiateSend();
    await this.transferBytesToCpu(toCpu);
    const reply =
      fromCpu > 0 ? await this.receiveBytesFromCpu(fromCpu) : new Uint8Array(0);
    if (thenToCpu && thenToCpu.length > 0) {
      await this.transferBytesToCpu(thenToCpu);
    }
    await this.finalizeSend();
    return reply;
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
   * IO→CPU メモリ読み出し（コマンド 13h）。同一 ENA でヘッダ→ブロック+checksum→OK/NG。
   * アドレス・バイト数は線上ビッグエンディアン。端数はパディングしない。
   * @param byteAddr 読み出し開始バイトアドレス
   * @param byteCount 読み出しバイト数（0 ならヘッダのみ）
   * @returns 読み出したバイト列
   */
  async memRead(byteAddr: number, byteCount: number): Promise<Uint8Array> {
    const count = byteCount >>> 0;
    const out = new Uint8Array(count);
    await this.initiateSend();
    await this.transferBytesToCpu(
      Uint8Array.from([
        CMD_IO_TO_CPU.MEM_READ,
        ...u32be(byteAddr >>> 0),
        ...u32be(count),
      ]),
    );
    let offset = 0;
    while (offset < count) {
      const blk = Math.min(HSHK_MEM_BLOCK, count - offset);
      let accepted = false;
      for (let attempt = 0; attempt < HSHK_MEM_RETRY_MAX; attempt++) {
        const rec = await this.receiveBytesFromCpu(blk + 1);
        const data = rec.subarray(0, blk);
        const sum = rec[blk]!;
        if (calcBlockChecksum(data) === sum) {
          out.set(data, offset);
          await this.transferBytesToCpu(Uint8Array.from([RESPONSE_CODE.OK]));
          accepted = true;
          break;
        }
        await this.transferBytesToCpu(Uint8Array.from([RESPONSE_CODE.NG]));
      }
      if (!accepted) {
        await this.finalizeSend();
        throw new Error("handshake 13h checksum failed");
      }
      offset += blk;
    }
    await this.finalizeSend();
    return out;
  }

  /**
   * IO→CPU アドレス／IO ブレイク設定（コマンド 10h）。
   * 同一 ENA で 10 バイト送り、CPU の status 1 バイトを待つ。
   * @param payload コマンド除く 9 バイト（slot, flags, count, addr32 BE, data16 BE）
   * @returns OK=0 / NG=1（受信失敗時も NG）
   */
  async addrBreakSet(payload: Uint8Array): Promise<number> {
    if (payload.length !== ADDR_BREAK_SET_PAYLOAD_LEN) {
      return RESPONSE_CODE.NG;
    }
    const frame = new Uint8Array(ADDR_BREAK_SET_FRAME_LEN);
    frame[0] = CMD_IO_TO_CPU.BREAK_MEM_IO_SET;
    frame.set(payload, 1);
    const reply = await this.sendReceive(frame, 1);
    return (reply[0] ?? RESPONSE_CODE.NG) & 0xff;
  }

  /**
   * IO→CPU アドレス／IO ブレイク解除（コマンド 11h）。
   * @param slot ブレイク設定番号（0–7）
   * @returns OK=0 / NG=1
   */
  async addrBreakClr(slot: number): Promise<number> {
    const frame = Uint8Array.from([
      CMD_IO_TO_CPU.BREAK_MEM_IO_CLR,
      slot & 0xff,
    ]);
    const reply = await this.sendReceive(frame, 1);
    return (reply[0] ?? RESPONSE_CODE.NG) & 0xff;
  }

  /**
   * IO→CPU メモリ書き込み（コマンド 14h）。同一 ENA でヘッダ→データ+checksum→OK/NG。
   * @param byteAddr 書き込み開始バイトアドレス
   * @param data 書き込むバイト列（0 長ならヘッダのみ）
   */
  async memWrite(byteAddr: number, data: Uint8Array): Promise<void> {
    await this.initiateSend();
    await this.transferBytesToCpu(
      Uint8Array.from([
        CMD_IO_TO_CPU.MEM_WRITE,
        ...u32be(byteAddr >>> 0),
        ...u32be(data.length),
      ]),
    );
    let offset = 0;
    while (offset < data.length) {
      const blk = Math.min(HSHK_MEM_BLOCK, data.length - offset);
      const slice = data.subarray(offset, offset + blk);
      const frame = new Uint8Array(blk + 1);
      frame.set(slice, 0);
      frame[blk] = calcBlockChecksum(slice);
      let accepted = false;
      for (let attempt = 0; attempt < HSHK_MEM_RETRY_MAX; attempt++) {
        await this.transferBytesToCpu(frame);
        const st = await this.receiveBytesFromCpu(1);
        if (st[0] === RESPONSE_CODE.OK) {
          accepted = true;
          break;
        }
      }
      if (!accepted) {
        await this.finalizeSend();
        throw new Error("handshake 14h NG");
      }
      offset += blk;
    }
    await this.finalizeSend();
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
