/**
 * IO ボードスピーカー相当（ハンドシェイク 19h）
 * エミュレータでは Web Audio の正弦波で鳴らす。
 */

import { resolveBeepAction, type BeepWire } from "../shared/beep";

/** クリックノイズを抑えるフェード（秒） */
const FADE_SEC = 0.012;
/** スピーカー音量（0–1） */
const GAIN = 0.12;

/**
 * 19h を Web Audio で再生する。
 * frequencyHz=0 で停止、durationMs=0 は次の指示まで鳴らし続ける。
 */
export class BeepPlayer {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 自動再生制限を解除する（キー操作などユーザー操作の直後に呼ぶ）。
   */
  unlock(): void {
    void this.ensureContext()?.resume();
  }

  /**
   * 19h の周波数・長さをスピーカーへ反映する。
   * @param params 周波数 Hz と長さ ms
   */
  apply(params: BeepWire): void {
    const action = resolveBeepAction(params);
    if (action.type === "stop") {
      this.stopNow();
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) return;
    void ctx.resume().then(() => {
      if (ctx.state !== "running") return;
      this.startTone(ctx, action.frequencyHz, action.stopAfterMs);
    });
  }

  /**
   * 正弦波を開始する（AudioContext が running のときだけ呼ぶ）。
   * @param ctx 使用中の AudioContext
   * @param frequencyHz 周波数 Hz
   * @param stopAfterMs 自動停止までの ms。null なら無限
   */
  private startTone(
    ctx: AudioContext,
    frequencyHz: number,
    stopAfterMs: number | null,
  ): void {
    this.stopNow();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequencyHz;
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(GAIN, t0 + FADE_SEC);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    this.osc = osc;
    this.gain = gain;
    if (stopAfterMs != null) {
      this.stopTimer = setTimeout(() => {
        this.stopNow();
      }, stopAfterMs);
    }
  }

  /** 鳴動を止め AudioContext は残す */
  dispose(): void {
    this.stopNow();
  }

  /**
   * AudioContext をまだ無ければ作る。
   * @returns ブラウザ／Electron で AudioContext が使えるときそのインスタンス
   */
  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (
            globalThis as typeof globalThis & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  /** 発振をフェードアウトして切る */
  private stopNow(): void {
    if (this.stopTimer != null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const ctx = this.ctx;
    const osc = this.osc;
    const gain = this.gain;
    this.osc = null;
    this.gain = null;
    if (!osc || !gain || !ctx) return;
    const t0 = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(t0);
      gain.gain.setValueAtTime(gain.gain.value, t0);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + FADE_SEC);
      osc.stop(t0 + FADE_SEC);
    } catch {
      try {
        osc.stop();
      } catch {
        /* 既に stop 済み */
      }
    }
  }
}
