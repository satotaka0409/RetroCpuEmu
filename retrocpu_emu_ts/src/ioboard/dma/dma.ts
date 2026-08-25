/**
 * DMA バス信号シミュ（ioboard.mdc）
 *
 * 本番の RAM 書き込みは CPU ボードの `CpuDmaTarget`（書き込み専用）。
 * 本クラスは同一プロセス試験用のバス波形＋書き込みアダプタ。
 * IO→CPU DMA の読み込みは仕様上禁止（read API なし。読みはハンドシェイク 13h）。
 *
 * HALT / RUN は CPU の setPins({ HLT }) / getPins().RUN に配線する。
 */

import { getPins, setPins } from "../../cpuboard/mn1613/mn1613";

export type Bit = 0 | 1;

export interface DmaSignals {
  /** 8bit データ／アドレス／コマンド */
  DATA: number;
  A_ENABLE: Bit;
  D_ENABLE: Bit;
  CLK: Bit;
  /** HALT 線のミラー（実制御は setPins） */
  HALT: Bit;
  /** RUN 線のミラー（実体は getPins().RUN） */
  RUN: Bit;
  DMA_ENA: Bit;
}

/** 書き込み専用メモリアダプタ（読み込みメソッドを持たない） */
export type DmaWriteMemory = {
  writeWord: (wordAddr: number, value: number) => void;
};

/** CPU との HALT/RUN 接続（テスト差し替え可） */
export type DmaCpuBridge = {
  assertHalt: () => void;
  releaseHalt: () => void;
  isRunning: () => boolean;
};

export const liveDmaCpuBridge: DmaCpuBridge = {
  assertHalt: () => setPins({ HLT: true }),
  releaseHalt: () => setPins({ HLT: false }),
  isRunning: () => getPins().RUN,
};

/**
 * DMA バス信号を全て 0 で初期化して返す。
 * @returns 新しいバス状態オブジェクト
 */
export function createDmaBus(): DmaSignals {
  return {
    DATA: 0,
    A_ENABLE: 0,
    D_ENABLE: 0,
    CLK: 0,
    HALT: 0,
    RUN: 0,
    DMA_ENA: 0,
  };
}

let _dmaBusy = false;

/**
 * DMA セッション中かどうかを返す。
 * @returns true なら転送中
 */
export function isDmaBusy(): boolean {
  return _dmaBusy;
}

/**
 * イベントループへ制御を返す（クロック生成と RUN 待ちに使う）。
 * @returns 次のタスクで解決する Promise
 */
function yield0(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * CLK を 1 → 0 と 1 パルス出す。
 * @param bus 対象バス
 */
async function pulseClk(bus: DmaSignals): Promise<void> {
  bus.CLK = 1;
  await yield0();
  bus.CLK = 0;
  await yield0();
}

/**
 * IOボード側 DMA マスタ（書き込み専用）。
 * 仕様: HALT 確定・RUN 無効後のみ A/D_ENABLE 有効。読み込みサイクルは無い。
 */
export class DmaMaster {
  private readonly cpu: DmaCpuBridge;

  /**
   * @param bus 波形を出す DMA バス
   * @param mem 書き込み先メモリアダプタ
   * @param timeoutMs RUN=0 になるまでの待ち時間上限（ミリ秒）
   * @param cpu HALT/RUN の接続先（テストで差し替え可）
   */
  constructor(
    private readonly bus: DmaSignals,
    private readonly mem: DmaWriteMemory,
    private readonly timeoutMs = 5000,
    cpu: DmaCpuBridge = liveDmaCpuBridge,
  ) {
    this.cpu = cpu;
  }

  /**
   * メモリへバイト列書き込み（ビッグエンディアン、ワード単位で転送。奇数末尾は下位のみ）。
   * @param byteAddr バイトアドレス（MN1613 ワード空間では wordAddr*2 相当を想定）
   */
  async writeBytes(byteAddr: number, data: Uint8Array): Promise<void> {
    await this.beginSession();
    try {
      let offset = 0;
      let addr = byteAddr >>> 0;
      while (offset < data.length) {
        const hi = data[offset]!;
        const lo = offset + 1 < data.length ? data[offset + 1]! : 0;
        const word = ((hi & 0xff) << 8) | (lo & 0xff);
        const wordAddr = (addr / 2) >>> 0;
        await this.writeWordCycle(wordAddr, word, true);
        offset += 2;
        addr += 2;
      }
    } finally {
      await this.endSession();
    }
  }

  /** CPU の実行状態をバスの RUN ミラーへ反映する */
  private syncRunMirror(): void {
    this.bus.RUN = this.cpu.isRunning() ? 1 : 0;
  }

  /**
   * DMA_ENA / HALT を立てて RUN=0 を待ち、転送を開始できる状態にする。
   * @throws RUN=0 待ちがタイムアウトした場合（信号は元に戻す）
   */
  private async beginSession(): Promise<void> {
    _dmaBusy = true;
    this.bus.A_ENABLE = 0;
    this.bus.D_ENABLE = 0;
    this.bus.DMA_ENA = 1;
    this.bus.HALT = 1;
    this.cpu.assertHalt();
    this.syncRunMirror();

    const deadline = Date.now() + this.timeoutMs;
    while (this.cpu.isRunning()) {
      this.syncRunMirror();
      if (Date.now() > deadline) {
        this.cpu.releaseHalt();
        this.bus.HALT = 0;
        this.bus.DMA_ENA = 0;
        this.syncRunMirror();
        _dmaBusy = false;
        throw new Error("DMA wait RUN=0 timeout");
      }
      await yield0();
    }
    this.syncRunMirror();
  }

  /** 全信号を戻し HALT を解除してセッションを閉じる */
  private async endSession(): Promise<void> {
    this.bus.A_ENABLE = 0;
    this.bus.D_ENABLE = 0;
    this.bus.DMA_ENA = 0;
    this.bus.HALT = 0;
    this.cpu.releaseHalt();
    this.syncRunMirror();
    _dmaBusy = false;
  }

  /**
   * A_ENABLE を立ててアドレスを上位バイトから 4 回に分けて出す。
   * @param wordAddr 転送先ワードアドレス
   */
  private async putAddress(wordAddr: number): Promise<void> {
    const a = wordAddr >>> 0;
    const bytes = [
      (a >>> 24) & 0xff,
      (a >>> 16) & 0xff,
      (a >>> 8) & 0xff,
      a & 0xff,
    ];
    this.bus.A_ENABLE = 1;
    for (let i = 0; i < 4; i++) {
      this.bus.DATA = bytes[i]!;
      await pulseClk(this.bus);
    }
    this.bus.A_ENABLE = 0;
  }

  /**
   * アドレス出力 → コマンド → 上位／下位バイトの 1 ワード書き込みサイクル。
   * @param wordAddr 転送先ワードアドレス
   * @param word 書き込む 16bit 値
   * @param memNotIo true=メモリ / false=I/O（コマンドの Bit0）
   */
  private async writeWordCycle(
    wordAddr: number,
    word: number,
    memNotIo: boolean,
  ): Promise<void> {
    await this.putAddress(wordAddr);
    // Bit0 0:IO/1:MEM , Bit1 0:WRT
    const cmd = (memNotIo ? 1 : 0) | 0;
    this.bus.D_ENABLE = 1;
    this.bus.DATA = cmd;
    await pulseClk(this.bus);
    this.bus.DATA = (word >>> 8) & 0xff;
    await pulseClk(this.bus);
    this.bus.DATA = word & 0xff;
    await pulseClk(this.bus);
    this.bus.D_ENABLE = 0;
    this.mem.writeWord(wordAddr, word & 0xffff);
  }
}

/** mn1613 ArrayBuffer 向け書き込み専用アダプタ */
export function dmaWriteMemoryFromArrayBuffer(
  buf: ArrayBufferLike,
): DmaWriteMemory {
  const view = new DataView(buf);
  return {
    writeWord(wordAddr: number, value: number): void {
      const off = (wordAddr & 0xffff) * 2;
      if (off + 1 >= view.byteLength) return;
      view.setUint16(off, value & 0xffff, false);
    },
  };
}

/** @deprecated dmaWriteMemoryFromArrayBuffer を使う */
export function dmaMemoryFromArrayBuffer(buf: ArrayBufferLike): DmaWriteMemory {
  return dmaWriteMemoryFromArrayBuffer(buf);
}
