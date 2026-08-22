/**
 * TMS9995 内蔵タイマー CRU フラグ（R12=1EE0h, SBO/SBZ #0/#1）。
 * io_ports と tms9995 コアの双方から参照（循環 import 回避）。
 */

let _decEnabled = false;

/** CRU 1EE0/1EE1 への書き込みでデクリメンタ有効を追跡 */
export function notifyCruFlagWrite(bitAddr: number, value: 0 | 1): void {
  if (bitAddr === 0x1ee1) _decEnabled = value === 1;
}

/**
 * CRU タイマーフラグ 1bit 読取（現状 1EE1 のみ）。
 * @param bitAddr CRU ビットアドレス
 */
export function readCruTimerFlagBit(bitAddr: number): 0 | 1 {
  if (bitAddr === 0x1ee1 && _decEnabled) return 1;
  return 0;
}

/** デクリメンタ有効フラグ（テスト用） */
export function setDecrementerEnabled(enabled: boolean): void {
  _decEnabled = enabled;
}

/** デクリメンタ有効フラグを返す */
export function getDecrementerEnabled(): boolean {
  return _decEnabled;
}

/** リセット時にデクリメンタ状態を初期化 */
export function resetCruTimerFlags(): void {
  _decEnabled = false;
}
