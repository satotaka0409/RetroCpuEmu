/**
 * IO ボードの 64bit 時刻タイマー（ハンドシェイク 11h）
 * 根拠: HandShake.mdc「時刻取得」/ ioboard.mdc
 *
 * IO ボード開始時に 0 クリアし、だいたい 10µs ごとに +1。
 * 実機は RP2354B のハードウェアカウンタ。エミュは経過 ns からティックを換算する
 * （10µs 間隔の setTimeout は使わない）。
 */

/** 1 ティックあたりのナノ秒（10µs） */
export const IO_TIME_TICK_NS = 10_000n;

/** 64bit 符号なしのマスク */
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

/** 時刻取得（11h）が読む 64bit タイマーの供給元 */
export type IoTimeSource = {
  /**
   * 64bit 時刻を上位バイト先頭の 8 バイトで返す（HandShake.mdc 11h）。
   * @returns 長さ 8。index 0 = 時刻7（MSB）
   */
  readTimestamp(): Uint8Array;
};

export type IoTimeCounterOptions = {
  /**
   * 現在時刻 (ns、単調増加)。既定は `process.hrtime.bigint()`。
   * テストでは差し替えて進める。
   */
  nowNs?: () => bigint;
};

/**
 * IO ボード開始からの 10µs ティックを 64bit で数える。
 */
export class IoTimeCounter implements IoTimeSource {
  private readonly nowNs: () => bigint;
  private originNs = 0n;
  private started = false;
  private frozenTicks = 0n;

  /**
   * @param options 時刻源。省略時は hrtime。生成直後は停止（ティック 0）
   */
  constructor(options?: IoTimeCounterOptions) {
    this.nowNs = options?.nowNs ?? (() => process.hrtime.bigint());
  }

  /**
   * 0 クリアして数え始める（IO ボード開始）。
   */
  reset(): void {
    this.originNs = this.nowNs();
    this.frozenTicks = 0n;
    this.started = true;
  }

  /**
   * カウントを止める。以降の読み出しは停止直前のティックを返す。
   */
  stop(): void {
    if (!this.started) return;
    this.frozenTicks = this.currentTicks();
    this.started = false;
  }

  /**
   * 開始からのティック数（10µs 単位、64bit でラップ）。
   * 未開始・停止中は 0 または停止時の値。
   * @returns 0〜2^64-1
   */
  ticks(): bigint {
    if (!this.started) return this.frozenTicks;
    return this.currentTicks();
  }

  /**
   * 64bit 時刻を上位バイト先頭の 8 バイトで返す。
   * @returns 長さ 8。index 0 = 時刻7（MSB）
   */
  readTimestamp(): Uint8Array {
    let v = this.ticks();
    const out = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    return out;
  }

  /**
   * 稼働中か。
   * @returns reset 後で stop 前なら true
   */
  get running(): boolean {
    return this.started;
  }

  /**
   * 起点からの経過を 10µs ティックに換算する（64bit ラップ）。
   * @returns ティック
   */
  private currentTicks(): bigint {
    const elapsed = this.nowNs() - this.originNs;
    if (elapsed <= 0n) return 0n;
    return (elapsed / IO_TIME_TICK_NS) & UINT64_MASK;
  }
}
