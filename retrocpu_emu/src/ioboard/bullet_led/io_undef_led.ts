/**
 * IO ボード上の未定義命令 LED（砲弾 B / UNDEF）
 *
 * ハンドシェイク 13h（HandShake.mdc「未定義命令LED」）で点灯／消灯する。
 * sticky: 13h 消灯または RST まで点灯を維持する（IISR をポーリングしない）。
 */

/** 砲弾 B (UNDEF) の点灯状態 */
let _undefLedOn = false;

/**
 * ハンドシェイク 0x13 受信時に呼ぶ。
 * @param on true=点灯 / false=消灯
 */
export function applyUndefLedCommand(on: boolean): void {
  _undefLedOn = on;
}

/**
 * 現在の UNDEF LED 状態を返す。
 * @returns true なら点灯中
 */
export function getUndefLed(): boolean {
  return _undefLedOn;
}

/** ラッチを消灯に戻す（リセット時・テスト用） */
export function resetUndefLed(): void {
  _undefLedOn = false;
}
