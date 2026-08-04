/**
 * DMA バス（ioboard.mdc）
 *
 * 1階(IO)がマスタ。CLK はハンドシェイクと共有可。
 * DMA_ENA アサート中は他処理を止める（emu_loop 側で isDmaBusy を見る）。
 *
 * HALT / RUN は CPU の setPins({ HLT }) / getPins().RUN に配線する。
 * （HSHK の CLK×8 シリアルはエミュしない。コマンド層・WS 呼び出しは後続）
 */

import { getPins, setPins } from "../cpu/mn1613/mn1613";

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

export type DmaMemory = {
  readWord: (wordAddr: number) => number;
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

export function isDmaBusy(): boolean {
  return _dmaBusy;
}

function yield0(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

async function pulseClk(bus: DmaSignals): Promise<void> {
  bus.CLK = 1;
  await yield0();
  bus.CLK = 0;
  await yield0();
}

/**
 * IOボード側 DMA マスタ。
 * 仕様: HALT 確定・RUN 無効後のみ A/D_ENABLE 有効。
 */
export class DmaMaster {
  private readonly cpu: DmaCpuBridge;

  constructor(
    private readonly bus: DmaSignals,
    private readonly mem: DmaMemory,
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

  async readBytes(byteAddr: number, length: number): Promise<Uint8Array> {
    await this.beginSession();
    try {
      const out = new Uint8Array(length);
      let offset = 0;
      let addr = byteAddr >>> 0;
      while (offset < length) {
        const wordAddr = (addr / 2) >>> 0;
        const word = await this.readWordCycle(wordAddr, true);
        out[offset] = (word >>> 8) & 0xff;
        if (offset + 1 < length) out[offset + 1] = word & 0xff;
        offset += 2;
        addr += 2;
      }
      return out;
    } finally {
      await this.endSession();
    }
  }

  private syncRunMirror(): void {
    this.bus.RUN = this.cpu.isRunning() ? 1 : 0;
  }

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

  private async endSession(): Promise<void> {
    this.bus.A_ENABLE = 0;
    this.bus.D_ENABLE = 0;
    this.bus.DMA_ENA = 0;
    this.bus.HALT = 0;
    this.cpu.releaseHalt();
    this.syncRunMirror();
    _dmaBusy = false;
  }

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

  private async readWordCycle(
    wordAddr: number,
    memNotIo: boolean,
  ): Promise<number> {
    await this.putAddress(wordAddr);
    // Bit0 MEM, Bit1 RD=1
    const cmd = (memNotIo ? 1 : 0) | 0b10;
    this.bus.D_ENABLE = 1;
    this.bus.DATA = cmd;
    await pulseClk(this.bus);
    const word = this.mem.readWord(wordAddr) & 0xffff;
    this.bus.DATA = (word >>> 8) & 0xff;
    await pulseClk(this.bus);
    this.bus.DATA = word & 0xff;
    await pulseClk(this.bus);
    this.bus.D_ENABLE = 0;
    return word;
  }
}

/** mn1613 ArrayBuffer（ワードビッグエンディアン）向けアダプタ */
export function dmaMemoryFromArrayBuffer(buf: ArrayBuffer): DmaMemory {
  const view = new DataView(buf);
  return {
    readWord(wordAddr: number): number {
      const off = (wordAddr & 0xffff) * 2;
      if (off + 1 >= view.byteLength) return 0;
      return view.getUint16(off, false);
    },
    writeWord(wordAddr: number, value: number): void {
      const off = (wordAddr & 0xffff) * 2;
      if (off + 1 >= view.byteLength) return;
      view.setUint16(off, value & 0xffff, false);
    },
  };
}
