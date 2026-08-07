/**
 * CPU ボード側 DMA ターゲット（ioboard.mdc）
 *
 * - RAM は CPU ボード専有
 * - IO からは書き込みのみ（読み込み API なし）
 * - HALT または RESET（idle / RST / halted）時のみ許可
 */

import {
  getExecStatus,
  getMemory,
  getPins,
  setPins,
} from "../cpu/mn1613/mn1613";

export type CpuDmaHooks = {
  /** DMA 開始／終了（共有 CTRL.DMA_BUSY など） */
  onBusy?: (busy: boolean) => void;
};

let _busy = false;

export function isCpuDmaBusy(): boolean {
  return _busy;
}

function mayTouchMemory(): boolean {
  const pins = getPins();
  const st = getExecStatus();
  if (pins.HLT || pins.RST) return true;
  if (st === "idle" || st === "halted") return true;
  return false;
}

function assertWritable(): void {
  if (!mayTouchMemory()) {
    throw new Error("DMA write only allowed during HALT/RESET");
  }
}

function writeWordToRam(wordAddr: number, value: number): void {
  const view = new DataView(getMemory());
  const off = (wordAddr & 0xffff) * 2;
  if (off + 1 >= view.byteLength) {
    throw new Error(`DMA write out of range wordAddr=0x${wordAddr.toString(16)}`);
  }
  view.setUint16(off, value & 0xffff, false);
}

function yield0(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * CPU ボード上の DMA 受け口。読み込みメソッドは持たない。
 */
export class CpuDmaTarget {
  constructor(
    private readonly timeoutMs = 5000,
    private readonly hooks: CpuDmaHooks = {},
  ) {}

  /**
   * バイト列を RAM に書く（ビッグエンディアン、ワード単位。奇数末尾は下位 0 埋め）。
   * 実行中なら HALT して RUN 落ちを待ってから書く。
   */
  async writeBytes(byteAddr: number, data: Uint8Array): Promise<void> {
    await this.begin();
    try {
      let offset = 0;
      let addr = byteAddr >>> 0;
      while (offset < data.length) {
        assertWritable();
        const hi = data[offset]!;
        const lo = offset + 1 < data.length ? data[offset + 1]! : 0;
        const word = ((hi & 0xff) << 8) | (lo & 0xff);
        writeWordToRam((addr / 2) >>> 0, word);
        offset += 2;
        addr += 2;
      }
    } finally {
      this.end();
    }
  }

  /** ワード列書き込み（同上ゲート） */
  async writeWords(wordAddr: number, words: number[]): Promise<void> {
    await this.begin();
    try {
      let a = wordAddr >>> 0;
      for (const w of words) {
        assertWritable();
        writeWordToRam(a, w & 0xffff);
        a = (a + 1) >>> 0;
      }
    } finally {
      this.end();
    }
  }

  private async begin(): Promise<void> {
    if (_busy) throw new Error("DMA already busy");
    _busy = true;
    this.hooks.onBusy?.(true);

    const running = getExecStatus() === "running" || getPins().RUN;
    if (running) {
      setPins({ HLT: true });
      const deadline = Date.now() + this.timeoutMs;
      while (getPins().RUN) {
        if (Date.now() > deadline) {
          setPins({ HLT: false });
          _busy = false;
          this.hooks.onBusy?.(false);
          throw new Error("DMA wait RUN=0 timeout");
        }
        await yield0();
      }
    }

    assertWritable();
  }

  private end(): void {
    if (getPins().HLT) {
      setPins({ HLT: false });
    }
    _busy = false;
    this.hooks.onBusy?.(false);
  }
}
