/**
 * エミュレータ入力／出力ピン（retrocpu_emu.mdc）
 *
 * 入力: boolean[3]
 *   [0] 現在値（外部から設定可能なのはここだけ） true=Enable（負論理ピンも論理true）
 *   [1] 1つ前の値（[0] と比較してエッジ検出）
 *   [2] 受付不可時に [0]=true なら保留。処理可能になったら再試行
 *
 * 出力: boolean[2]
 *   [0] 現在値
 *   [1] 1つ前の値
 */

export type InputPin = [boolean, boolean, boolean];
export type OutputPin = [boolean, boolean];

/**
 * 入力ピンを作る。
 * @param initial 初期レベル（true=Enable）
 * @returns [現在値, 前回値, 保留フラグ]
 */
export function createInputPin(initial = false): InputPin {
  return [initial, initial, false];
}

/**
 * 出力ピンを作る。
 * @param initial 初期レベル（true=Enable）
 * @returns [現在値, 前回値]
 */
export function createOutputPin(initial = false): OutputPin {
  return [initial, initial];
}

/** 外部から現在値だけ更新 */
export function setInputLevel(pin: InputPin, enable: boolean): void {
  pin[0] = enable;
}

/**
 * 出力ピンの現在値を更新する。
 * @param pin 対象ピン
 * @param enable true=Enable
 */
export function setOutputLevel(pin: OutputPin, enable: boolean): void {
  pin[0] = enable;
}

/**
 * 立ち上がりエッジか判定する。
 * @param pin 対象ピン
 * @returns 前回 false かつ今回 true なら true
 */
export function risingEdge(pin: InputPin | OutputPin): boolean {
  return pin[0] && !pin[1];
}

/**
 * 立ち下がりエッジか判定する。
 * @param pin 対象ピン
 * @returns 前回 true かつ今回 false なら true
 */
export function fallingEdge(pin: InputPin | OutputPin): boolean {
  return !pin[0] && pin[1];
}

/** サイクル末尾で [1] ← [0] */
export function commitSample(pin: InputPin | OutputPin): void {
  pin[1] = pin[0];
}

/** 受付不可でアサート中なら [2] に残す */
export function deferIfAsserted(pin: InputPin): void {
  if (pin[0]) pin[2] = true;
}

/** 保留を取り出し（true なら直ちに処理開始） */
export function takeDeferred(pin: InputPin): boolean {
  if (!pin[2]) return false;
  pin[2] = false;
  return true;
}

/**
 * 保留を破棄する（リセット時など）。
 * @param pin 対象ピン
 */
export function clearDeferred(pin: InputPin): void {
  pin[2] = false;
}
