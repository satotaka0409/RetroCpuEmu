/**
 * 制御・I/O ボード側ハンドシェイク（TypeScript / HandShake.mdc）
 *
 * board/handshake から再エクスポートする。CPU 側はアセンブラ実装。
 * データ転送は 2 バイト単位。奇数論理長は 0 パッド。
 */

import type { CpuIoSignals } from "../../cpuboard/mn1613/mn1613ioport";
import {
  ADDR_BREAK_SET_PAYLOAD_LEN,
  ADDR_BREAK_SET_FRAME_LEN,
  CMD_IO_TO_CPU,
  DEFAULT_TIMEOUT_MS,
  HSHK_IO_MAX_BYTES,
  INT_CAUSE_CODE,
  RESPONSE_CODE,
  setHshkInReq,
  u32be,
  waitCondition,
} from "./handshake_type";

/** IO→CPU 送信の開始オプション */
export type HandshakeSendOptions = {
  /**
   * IN_REQ でレベル2割り込みを起こすか。既定 true。
   * CPU→IO の status 応答は false（BIOS が IN_REQ をポーリングする）。
   */
  raiseIrq?: boolean;
};

export class IoControlHandshake {
  /**
   * @param bus CPU と共有する制御信号／データ線
   * @param timeoutMs 各信号待ちのタイムアウト（ミリ秒）
   * @param onPoll 信号待ち中に 1 命令進める（同一スレッド。BIOS `run()` テストでは渡さない）
   */
  constructor(
    private readonly bus: CpuIoSignals,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly onPoll?: () => void,
  ) {}

  /**
   * IO→CPU 方向へ 1 フレーム送る（開始 → データ転送 → 完了）。
   * @param data 送信バイト列
   * @param options raiseIrq=false で INT2 なし（CPU→IO 応答）
   */
  async send(data: Uint8Array, options?: HandshakeSendOptions): Promise<void> {
    await this.initiateSend(options);
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
   * IO→CPU メモリ読み出し（コマンド 13h）。ヘッダ 10B（末尾パッド）→データ→OK。
   * @param byteAddr 読み出し開始バイトアドレス
   * @param byteCount 読み出しバイト数（0 ならデータなしで status のみ）
   * @returns 読み出したバイト列
   */
  async memRead(byteAddr: number, byteCount: number): Promise<Uint8Array> {
    const count = byteCount >>> 0;
    await this.initiateSend();
    await this.transferBytesToCpu(
      Uint8Array.from([
        this.toWireIoToCpuCmd(CMD_IO_TO_CPU.MEM_READ),
        ...u32be(byteAddr >>> 0),
        ...u32be(count),
        0,
      ]),
    );
    const out =
      count > 0 ? await this.receiveBytesFromCpu(count) : new Uint8Array(0);
    await this.transferBytesToCpu(Uint8Array.from([RESPONSE_CODE.OK]));
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
    frame[0] = this.toWireIoToCpuCmd(CMD_IO_TO_CPU.BREAK_MEM_IO_SET);
    frame.set(payload, 1);
    const reply = await this.sendReceive(frame, 1);
    return (reply[0] ?? RESPONSE_CODE.NG) & 0xff;
  }

  /**
   * IO→CPU アドレス／IO ブレイク解除（コマンド 11h）。
   * @param slot ブレイク設定番号（0–3）
   * @returns OK=0 / NG=1
   */
  async addrBreakClr(slot: number): Promise<number> {
    const frame = Uint8Array.from([
      this.toWireIoToCpuCmd(CMD_IO_TO_CPU.BREAK_MEM_IO_CLR),
      slot & 0xff,
    ]);
    const reply = await this.sendReceive(frame, 1);
    return (reply[0] ?? RESPONSE_CODE.NG) & 0xff;
  }

  /**
   * IO→CPU メモリ書き込み（コマンド 14h）。ヘッダ 10B（末尾パッド）＋データ→OK/NG。
   * @param byteAddr 書き込み開始バイトアドレス
   * @param data 書き込むバイト列（0 長ならヘッダのあと status のみ）
   */
  async memWrite(byteAddr: number, data: Uint8Array): Promise<void> {
    const n = data.length >>> 0;
    const frame = new Uint8Array(10 + n);
    frame[0] = this.toWireIoToCpuCmd(CMD_IO_TO_CPU.MEM_WRITE);
    frame.set(u32be(byteAddr >>> 0), 1);
    frame.set(u32be(n), 5);
    frame[9] = 0;
    frame.set(data, 10);
    await this.initiateSend();
    await this.transferBytesToCpu(frame);
    const st = await this.receiveBytesFromCpu(1);
    await this.finalizeSend();
    if (st[0] !== RESPONSE_CODE.OK) {
      throw new Error("handshake 14h NG");
    }
  }

  /**
   * IO→CPU IO読み出し（コマンド 15h）。ヘッダのあと CPU がデータ＋status を返す。
   * @param ioAddr 16bit IO アドレス
   * @param byteCount バイト数（0–254）
   * @returns 読み出したバイト列
   */
  async ioRead(ioAddr: number, byteCount: number): Promise<Uint8Array> {
    const count = byteCount & 0xff;
    if (count > HSHK_IO_MAX_BYTES) {
      throw new Error("handshake 15h count");
    }
    await this.initiateSend();
    await this.transferBytesToCpu(
      Uint8Array.from([
        this.toWireIoToCpuCmd(CMD_IO_TO_CPU.IO_READ),
        (ioAddr >>> 8) & 0xff,
        ioAddr & 0xff,
        count,
      ]),
    );
    const rec = await this.receiveBytesFromCpu(count + 1);
    await this.finalizeSend();
    if (rec[count] !== RESPONSE_CODE.OK) {
      throw new Error("handshake 15h NG");
    }
    return rec.subarray(0, count);
  }

  /**
   * IO→CPU IO書き込み（コマンド 16h）。ヘッダ＋データのあと status。
   * @param ioAddr 16bit IO アドレス
   * @param data 書き込むバイト列（長さ 0–254）
   */
  async ioWrite(ioAddr: number, data: Uint8Array): Promise<void> {
    const n = data.length;
    if (n > HSHK_IO_MAX_BYTES) {
      throw new Error("handshake 16h count");
    }
    const frame = new Uint8Array(4 + n);
    frame[0] = this.toWireIoToCpuCmd(CMD_IO_TO_CPU.IO_WRITE);
    frame[1] = (ioAddr >>> 8) & 0xff;
    frame[2] = ioAddr & 0xff;
    frame[3] = n & 0xff;
    frame.set(data, 4);
    await this.initiateSend();
    await this.transferBytesToCpu(frame);
    const st = await this.receiveBytesFromCpu(1);
    await this.finalizeSend();
    if (st[0] !== RESPONSE_CODE.OK) {
      throw new Error("handshake 16h NG");
    }
  }

  /**
   * 先頭1バイトを見て残余長を決め、同一 ENA セッションでフレーム全体を受信する。
   * CPU→IO コマンド（コマンドで転送長が確定）向け。
   */
  async receiveFramed(
    remainingAfterFirst: (firstByte: number) => number,
  ): Promise<Uint8Array> {
    await this.waitForCpuRequest();
    const [first, second] = await this.receiveUnitFromCpu();
    const rem = Math.max(0, remainingAfterFirst(first) | 0);
    let rest: Uint8Array;
    if (rem <= 0) {
      rest = new Uint8Array(0);
    } else if (rem === 1) {
      rest = Uint8Array.from([second]);
    } else {
      const tail = await this.receiveBytesFromCpu(rem - 1);
      rest = new Uint8Array(1 + tail.length);
      rest[0] = second;
      rest.set(tail, 1);
    }
    await this.finalizeReceive();
    const frame = new Uint8Array(1 + rest.length);
    frame[0] = first;
    frame.set(rest, 1);
    return frame;
  }

  /**
   * 先頭から可変長ルールで CPU→IO フレーム全体を受信する。
   * 線上は 2 バイト単位だが、返却は論理バイト列（末尾パディング除去）。
   *
   * @param remainingFromSoFar 現在までの論理バイト列に対し、残り必要バイト数を返す
   */
  async receiveFramedAdaptive(
    remainingFromSoFar: (frameSoFar: Uint8Array) => number,
  ): Promise<Uint8Array> {
    await this.waitForCpuRequest();

    const [first, second] = await this.receiveUnitFromCpu();
    const bytes: number[] = [first & 0xff];
    const pending: number[] = [second & 0xff];

    while (true) {
      const soFar = Uint8Array.from(bytes);
      const rem = Math.max(0, remainingFromSoFar(soFar) | 0);
      if (rem === 0) break;

      if (pending.length === 0) {
        try {
          const [b0, b1] = await this.receiveUnitFromCpu();
          pending.push(b0 & 0xff, b1 & 0xff);
        } catch {
          // 可変長拡張が来ない実装とも相互運用できるよう、ここまでで確定する。
          break;
        }
      }
      bytes.push(pending.shift()!);
    }

    await this.finalizeReceive();
    return Uint8Array.from(bytes);
  }

  /** CPU の REQ を待って依頼を受理する（DACK 初期化後、REQ 解除を待つ） */
  private async waitForCpuRequest(): Promise<void> {
    await this.wait(() => this.bus.HSHK_OUT_REQ === 1);
    this.bus.HSHK_OUT_DACK = 0;
  }

  /**
   * CPU から 2 バイトユニットを受け取る。
   * @returns [1バイト目, 2バイト目]
   */
  private async receiveUnitFromCpu(): Promise<[number, number]> {
    await this.wait(() => this.bus.HSHK_OUT_DENA === 1);
    const b0 = this.bus.HSHK_OUT_DATA & 0xff;
    this.bus.HSHK_OUT_DACK = 1;
    await this.wait(() => this.bus.HSHK_OUT_DENA === 0);
    const b1 = this.bus.HSHK_OUT_DATA & 0xff;
    this.bus.HSHK_OUT_DACK = 0;
    return [b0, b1];
  }

  /**
   * CPU から指定論理バイト数を受け取る（奇数はユニット末尾のパッドを捨てる）。
   * @param length 受信バイト数
   * @returns 受信バイト列
   */
  private async receiveBytesFromCpu(length: number): Promise<Uint8Array> {
    const data = new Uint8Array(length);
    let i = 0;
    while (i < length) {
      const [b0, b1] = await this.receiveUnitFromCpu();
      data[i] = b0;
      i += 1;
      if (i < length) {
        data[i] = b1;
        i += 1;
      }
    }
    return data;
  }

  /**
   * 信号条件を待つ（同一スレッドなら onPoll で CPU を進める）。
   * @param condition 成立したら true
   */
  private wait(condition: () => boolean): Promise<void> {
    return waitCondition(condition, this.timeoutMs, this.onPoll);
  }

  /** 受信完了（CPU 側が REQ_0 を下げるまで待つ） */
  private async finalizeReceive(): Promise<void> {
    await this.wait(() => this.bus.HSHK_OUT_REQ === 0);
  }

  /**
   * IO→CPU 送信を開始する。
   * 割り込み要因を HANDSHAKE にして REQ で CPU へ依頼する。
   * @param options raiseIrq=false なら REQ_1 のみ（INT2 なし）
   */
  private async initiateSend(options?: HandshakeSendOptions): Promise<void> {
    const raiseIrq = options?.raiseIrq !== false;
    await this.wait(
      () =>
        this.bus.INTERRUPT_BUSY === 0 &&
        this.bus.HSHK_OUT_REQ === 0 &&
        this.bus.HSHK_IN_REQ === 0,
    );
    this.bus.HSHK_IN_DENA = 0;
    this.bus.INT_CAUSE = INT_CAUSE_CODE.HANDSHAKE;
    setHshkInReq(this.bus, 1, raiseIrq);
  }

  /**
   * CPU へ 2 バイトユニットを渡す。
   * @param b0 1バイト目
   * @param b1 2バイト目
   */
  private async transferUnitToCpu(b0: number, b1: number): Promise<void> {
    this.bus.HSHK_IN_DATA = b0 & 0xff;
    this.bus.HSHK_IN_DENA = 1;
    await this.wait(() => this.bus.HSHK_IN_DACK === 1);
    this.bus.HSHK_IN_DATA = b1 & 0xff;
    this.bus.HSHK_IN_DENA = 0;
    await this.wait(() => this.bus.HSHK_IN_DACK === 0);
  }

  /**
   * CPU へ論理バイト列を渡す（奇数長は 0 パッド）。
   * @param data 送信バイト列
   */
  private async transferBytesToCpu(data: Uint8Array): Promise<void> {
    for (let i = 0; i < data.length; i += 2) {
      const b1 = i + 1 < data.length ? data[i + 1]! : 0;
      await this.transferUnitToCpu(data[i]!, b1);
    }
  }

  /** 送信完了（信号は transfer 内で終端済み） */
  private async finalizeSend(): Promise<void> {
    await this.wait(() => this.bus.HSHK_IN_DACK === 0);
    setHshkInReq(this.bus, 0, false);
  }

  /**
   * IO→CPU コマンドIDを線上値へ正規化する。
   * 高位 API では 0x80-0x88 を使うが、ハンドシェイク線上は 0x10-0x18。
   */
  private toWireIoToCpuCmd(cmd: number): number {
    const v = cmd & 0xff;
    if (v >= 0x80 && v <= 0x88) {
      return (v - 0x70) & 0xff;
    }
    return v;
  }
}
