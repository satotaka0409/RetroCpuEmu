/**
 * CPU ボード側 DMA ターゲット（ioboard.mdc）
 *
 * - RAM は CPU ボード専有
 * - IO→CPU は **書き込みのみ**。読み込みメソッドは持たない（読みはハンドシェイク 13h）
 * - HALT または RESET（idle / RST / halted）時のみ許可
 */

import { CPU_TYPE } from "../ioboard/setting_area";
import { getCpuCore } from "./cpu_core";

export type CpuDmaHooks = {
  /** DMA 開始／終了（共有 CTRL.DMA_BUSY など） */
  onBusy?: (busy: boolean) => void;
};

/**
 * IO ボードから見た DMA 面。書き込みだけ。読み込みは含めない（ioboard.mdc）。
 */
export type DmaWriteTarget = {
  writeBytes(byteAddr: number, data: Uint8Array): Promise<void>;
  writeWords(wordAddr: number, words: number[]): Promise<void>;
};

let _busy = false;

/**
 * DMA セッション中かどうかを返す。
 * @returns true なら転送中
 */
export function isCpuDmaBusy(): boolean {
  return _busy;
}

/**
 * いま RAM を触ってよいか（HALT / RESET 相当か）を判定する。
 * @returns 書き込み可能なら true
 */
function mayTouchMemory(cpuType: number): boolean {
  const core = getCpuCore(cpuType);
  const pins = core.getPins();
  const st = core.getExecStatus();
  if (pins.HLT || pins.RST) return true;
  if (st === "idle" || st === "halted") return true;
  return false;
}

/**
 * 書き込み可能状態でなければ例外にする。
 * @throws CPU が実行中の場合
 */
function assertWritable(cpuType: number): void {
  if (!mayTouchMemory(cpuType)) {
    throw new Error("DMA write only allowed during HALT/RESET");
  }
}

/**
 * RAM へ 1 ワード書く（ビッグエンディアン）。
 * @param cpuType CPU 種別
 * @param wordAddr ワードアドレス（MN1613）またはバイトアドレス÷2 相当
 * @param value 16bit 値
 * @throws メモリ範囲外の場合
 */
function writeWordToRam(
  cpuType: number,
  wordAddr: number,
  value: number,
): void {
  const view = new DataView(getCpuCore(cpuType).getMemory());
  if (cpuType === CPU_TYPE.TMS9995) {
    const off = wordAddr & 0xffff;
    if (off + 1 >= view.byteLength) {
      throw new Error(`DMA write out of range byteAddr=0x${off.toString(16)}`);
    }
    view.setUint16(off, value & 0xffff, false);
    return;
  }
  const off = (wordAddr & 0xffff) * 2;
  if (off + 1 >= view.byteLength) {
    throw new Error(`DMA write out of range wordAddr=0x${wordAddr.toString(16)}`);
  }
  view.setUint16(off, value & 0xffff, false);
}

/**
 * イベントループへ制御を返す（RUN 落ち待ちのポーリング用）。
 * @returns 次のタスクで解決する Promise
 */
function yield0(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * CPU ボード上の DMA 受け口。読み込みメソッドは持たない（`DmaWriteTarget`）。
 */
export class CpuDmaTarget implements DmaWriteTarget {
  /**
   * @param cpuType 1=MN1613 / 2=TMS9995
   * @param timeoutMs RUN=0 になるまでの待ち時間上限（ミリ秒）
   * @param hooks DMA 開始／終了の通知フック
   */
  constructor(
    private readonly cpuType: number,
    private readonly timeoutMs = 5000,
    private readonly hooks: CpuDmaHooks = {},
  ) {}

  /**
   * バイト列を RAM に書く。
   * 実行中なら HALT して RUN 落ちを待ってから書く。
   */
  async writeBytes(byteAddr: number, data: Uint8Array): Promise<void> {
    await this.begin();
    try {
      const view = new DataView(getCpuCore(this.cpuType).getMemory());
      let offset = 0;
      let addr = byteAddr >>> 0;
      while (offset < data.length) {
        assertWritable(this.cpuType);
        if (this.cpuType === CPU_TYPE.TMS9995) {
          view.setUint8(addr & 0xffff, data[offset]! & 0xff);
          offset += 1;
          addr += 1;
        } else {
          const hi = data[offset]!;
          const lo = offset + 1 < data.length ? data[offset + 1]! : 0;
          const word = ((hi & 0xff) << 8) | (lo & 0xff);
          writeWordToRam(this.cpuType, (addr / 2) >>> 0, word);
          offset += 2;
          addr += 2;
        }
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
        assertWritable(this.cpuType);
        writeWordToRam(this.cpuType, a, w & 0xffff);
        a = this.cpuType === CPU_TYPE.TMS9995 ? (a + 2) >>> 0 : (a + 1) >>> 0;
      }
    } finally {
      this.end();
    }
  }

  /**
   * DMA セッションを開始する。実行中なら HLT を立てて RUN=0 を待つ。
   * @throws 既に転送中の場合、RUN=0 待ちがタイムアウトした場合
   */
  private async begin(): Promise<void> {
    if (_busy) throw new Error("DMA already busy");
    _busy = true;
    this.hooks.onBusy?.(true);

    const core = getCpuCore(this.cpuType);
    const running = core.getExecStatus() === "running" || core.getPins().RUN;
    if (running) {
      core.setPins({ HLT: true });
      const deadline = Date.now() + this.timeoutMs;
      while (core.getPins().RUN) {
        if (Date.now() > deadline) {
          core.setPins({ HLT: false });
          _busy = false;
          this.hooks.onBusy?.(false);
          throw new Error("DMA wait RUN=0 timeout");
        }
        await yield0();
      }
    }

    assertWritable(this.cpuType);
  }

  /** DMA セッションを終了し、begin() で立てた HLT を戻す */
  private end(): void {
    const core = getCpuCore(this.cpuType);
    if (core.getPins().HLT) {
      core.setPins({ HLT: false });
    }
    _busy = false;
    this.hooks.onBusy?.(false);
  }
}
