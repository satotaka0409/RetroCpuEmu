/**
 * ハンドシェイク 19h（BEEP）の鳴動指示
 * 根拠: HandShake.mdc「BEEP音」
 */

/** IO ボード → 画面（Web Audio）へ渡す 19h パラメータ */
export type BeepWire = {
  /** 周波数 Hz。0 で停止 */
  frequencyHz: number;
  /** 鳴動時間 ms。0 で停止指示まで無限 */
  durationMs: number;
};

/**
 * 19h の周波数・長さから再生／停止を決める。
 * @param params 16bit 周波数と長さ（上位ビットは捨てる）
 * @returns 停止、または再生（無限なら stopAfterMs は null）
 */
export function resolveBeepAction(
  params: BeepWire,
):
  | { type: "stop" }
  | { type: "play"; frequencyHz: number; stopAfterMs: number | null } {
  const frequencyHz = params.frequencyHz & 0xffff;
  const durationMs = params.durationMs & 0xffff;
  if (frequencyHz === 0) {
    return { type: "stop" };
  }
  return {
    type: "play",
    frequencyHz,
    stopAfterMs: durationMs === 0 ? null : durationMs,
  };
}
