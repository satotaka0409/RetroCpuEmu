/**
 * IO ボードのタイマー（1階ボードのハードウェアタイマー相当）
 * 根拠: HandShake.mdc「タイマー設定」(12h) / ioboard.mdc
 *
 * リセット直後は停止状態。CPU ボードからハンドシェイク 12h で
 * 周期 (ms) と回数を受け取ったときだけ動き出す。周期 0 または
 * stop() で停止する。満了ごとに onExpire を呼ぶだけで、
 * レベル 2 割り込みの実配送は呼び出し側（IO ボード結線側）の責務。
 */

import { RESPONSE_CODE } from "../../shared/handshake/handshake_type";

/**
 * タイマー 1 本の設定値。
 * ハンドシェイク 12h の TimerParams からタイマー番号を除いた形。
 */
export type IoTimerConfig = {
  /** タイマー周期 (ms)。0 で停止。16bit */
  periodMs: number;
  /** 割り込み回数。0 で無限。16bit */
  count: number;
};

/** setTimeout 系の戻り値（Node / ブラウザ差を吸収するための不透明ハンドル） */
export type IoTimerHandle = ReturnType<typeof setTimeout>;

/** タイマー駆動に使うスケジューラ（テストで差し替える） */
export type IoTimerScheduler = {
  setTimeout(callback: () => void, ms: number): IoTimerHandle;
  clearTimeout(handle: IoTimerHandle): void;
};

export type IoTimerOptions = {
  /** 満了 1 回ごとに呼ばれる（割り込み配送はここで行う） */
  onExpire: () => void;
  /** 既定は node のグローバル setTimeout / clearTimeout */
  scheduler?: IoTimerScheduler;
  /**
   * 実際に待つ最小周期 (ms)。1ms 未満の周期指定を丸めるために使う。
   * 実機は RP2354B のハードウェアタイマーだが、エミュは setTimeout 粒度に従う。
   */
  minPeriodMs?: number;
};

/** タイマーの現在状態（UI・テスト用のスナップショット） */
export type IoTimerState = {
  /** 稼働中か */
  running: boolean;
  /** 設定周期 (ms)。停止中は 0 */
  periodMs: number;
  /** 設定回数。0 は無限 */
  count: number;
  /** 残り回数。無限（count=0）のときは 0 */
  remaining: number;
  /** 起動以降の累計満了回数 */
  fired: number;
};

/** 16bit で指定できる上限値（周期・回数とも） */
const MAX_16BIT = 0xffff;

export class IoTimer {
  private readonly onExpire: () => void;
  private readonly scheduler: IoTimerScheduler;
  private readonly minPeriodMs: number;

  private handle: IoTimerHandle | null = null;
  private periodMs = 0;
  private count = 0;
  private remaining = 0;
  private fired = 0;

  /**
   * @param options 満了コールバック、スケジューラ、最小周期
   */
  constructor(options: IoTimerOptions) {
    this.onExpire = options.onExpire;
    this.scheduler = options.scheduler ?? {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h),
    };
    this.minPeriodMs = options.minPeriodMs ?? 1;
  }

  /**
   * 稼働中か。
   * @returns 満了待ちの予約がある場合 true
   */
  get running(): boolean {
    return this.handle !== null;
  }

  /**
   * ハンドシェイク 12h の設定を適用する。
   * 稼働中に呼ばれた場合は現在の予約を捨てて新しい設定で開始し直す。
   * @param params 周期 (ms、0 で停止) と回数 (0 で無限)。ともに 16bit
   * @returns RESPONSE_CODE.OK / 値が不正なら RESPONSE_CODE.NG_OTHER_ERROR
   */
  configure(params: IoTimerConfig): number {
    if (!isUint16(params.periodMs) || !isUint16(params.count)) {
      return RESPONSE_CODE.NG_OTHER_ERROR;
    }
    this.stop();
    if (params.periodMs === 0) {
      return RESPONSE_CODE.OK;
    }
    this.periodMs = params.periodMs;
    this.count = params.count;
    this.remaining = params.count;
    this.fired = 0;
    this.arm();
    return RESPONSE_CODE.OK;
  }

  /** 予約を解除して停止状態に戻す（設定値もクリアする） */
  stop(): void {
    if (this.handle !== null) {
      this.scheduler.clearTimeout(this.handle);
      this.handle = null;
    }
    this.periodMs = 0;
    this.count = 0;
    this.remaining = 0;
  }

  /**
   * 現在の状態を返す。
   * @returns 稼働状態・周期・回数・残り回数・累計満了回数
   */
  getState(): IoTimerState {
    return {
      running: this.running,
      periodMs: this.periodMs,
      count: this.count,
      remaining: this.remaining,
      fired: this.fired,
    };
  }

  /** 次の満了を予約する（周期は minPeriodMs で下限を切る） */
  private arm(): void {
    const waitMs = Math.max(this.periodMs, this.minPeriodMs);
    this.handle = this.scheduler.setTimeout(() => {
      this.handle = null;
      this.expire();
    }, waitMs);
  }

  /**
   * 満了 1 回分を処理する。
   * 回数指定ありなら残りを減らし、尽きたら停止する。
   * onExpire より先に次の予約を済ませ、割り込み配送中の遅延で周期がずれないようにする。
   */
  private expire(): void {
    this.fired++;
    if (this.count > 0) {
      this.remaining--;
      if (this.remaining <= 0) {
        const notify = this.onExpire;
        this.stop();
        notify();
        return;
      }
    }
    this.arm();
    this.onExpire();
  }
}

/**
 * 16bit 符号なし整数として妥当か判定する。
 * @param v 検査する値
 * @returns 0〜65535 の整数なら true
 */
function isUint16(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= MAX_16BIT;
}
