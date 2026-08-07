/**
 * IO ボード上の表示ラッチ（7セグ + 砲弾 LED）
 *
 * ブートモニタは LED を使わない。
 * ユーザープログラムがハンドシェイク LED表示依頼 (0x16) で更新する。
 * RAM やレジスタを覗いて点灯させない。
 */

import {
  LED_SEVEN_SEG_COUNT,
  type LedDisplayData,
} from "../cpu/mn1613/handhshake/command_cpu_to_io";

function emptyLed(): LedDisplayData {
  return {
    sevenSeg: new Uint8Array(LED_SEVEN_SEG_COUNT),
    bulletLed0_7: 0,
    bulletLed8_F: 0,
  };
}

let _led: LedDisplayData = emptyLed();

/** ハンドシェイク 0x16 受信時に呼ぶ */
export function applyLedDisplayCommand(data: LedDisplayData): void {
  const segs = new Uint8Array(LED_SEVEN_SEG_COUNT);
  segs.set(data.sevenSeg.subarray(0, LED_SEVEN_SEG_COUNT));
  _led = {
    sevenSeg: segs,
    bulletLed0_7: data.bulletLed0_7 & 0xff,
    bulletLed8_F: data.bulletLed8_F & 0xff,
  };
}

export function getLedDisplay(): LedDisplayData {
  return {
    sevenSeg: _led.sevenSeg.slice(),
    bulletLed0_7: _led.bulletLed0_7,
    bulletLed8_F: _led.bulletLed8_F,
  };
}

export function resetLedDisplay(): void {
  _led = emptyLed();
}

/** スナップショット用の素の配列 */
export function getLedDisplayWire(): {
  sevenSeg: number[];
  bulletLed0_7: number;
  bulletLed8_F: number;
} {
  return {
    sevenSeg: Array.from(_led.sevenSeg),
    bulletLed0_7: _led.bulletLed0_7,
    bulletLed8_F: _led.bulletLed8_F,
  };
}
