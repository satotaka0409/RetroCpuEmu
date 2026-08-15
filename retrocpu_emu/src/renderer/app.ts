/**
 * IOボード画面
 * ファンクションキーは ioboard.mdc（ADS/RD/INC/DEC/WINC/RUN/H/ST/RST）。
 * パネル LED はコンソールが駆動。ユーザープログラムの 0x16 も同じラッチを使う。
 */

import { createSevenSegment, setSevenSegmentPattern } from "./seven_segment";
import { createLed, setLedOn, type LedColor } from "./led";
import { mountHexKeyboard } from "./hex_keyboard";
import { mountLcd1602, type Lcd1602View } from "./lcd1602";
import { FN_KEY_LABELS } from "../shared/fn_keys";
import type { EmuApi, EmuSnapshotWire } from "../shared/emu_api";

declare global {
  interface Window {
    emuApi: EmuApi;
  }
}

const ADDR_COLOR = "#ff3b1f";
const addrEls: HTMLElement[] = [];
const dataEls: HTMLElement[] = [];
const bulletEls: HTMLSpanElement[] = [];
let lcdView: Lcd1602View | null = null;

/**
 * 砲弾 LED 1 個分の要素（ラベル + LED）を作る。
 * @param index 砲弾番号 0〜15。ラベル省略時は 16 進 1 桁で表示する
 * @param opts showLabel=false でラベル無し、labelText で文字列上書き、
 *   labelAfter=true で LED の後ろにラベル、color で発光色を指定
 * @returns 追加用のラッパ要素と、点灯制御に使う LED 要素
 */
function createBulletItem(
  index: number,
  opts?: {
    showLabel?: boolean;
    labelText?: string;
    labelAfter?: boolean;
    color?: LedColor;
  },
): {
  item: HTMLDivElement;
  led: HTMLSpanElement;
} {
  const item = document.createElement("div");
  item.className = "bullet-led-item";
  const color = opts?.color ?? (index < 8 ? "red" : "orange");
  const led = createLed(color, 12);
  const showLabel = opts?.showLabel !== false;
  let label: HTMLSpanElement | null = null;
  if (showLabel) {
    label = document.createElement("span");
    label.className = "bullet-led-label";
    label.textContent = opts?.labelText ?? index.toString(16).toUpperCase();
  }
  if (label && !opts?.labelAfter) item.appendChild(label);
  item.appendChild(led);
  if (label && opts?.labelAfter) item.appendChild(label);
  return { item, led };
}

/**
 * 7セグ 12 桁・砲弾 LED・キーボードを組み立てて DOM に配置する。
 * 砲弾 E/F は ADDR/DATA の直下、RUN(C)/HALT(D)/UNDEF(B) は DATA 右のステータス列に置く。
 */
function initDom(): void {
  const addrBank = document.getElementById("addr-bank")!;
  const dataBank = document.getElementById("data-bank")!;
  const bulletRow = document.getElementById("bullet-row")!;
  const bulletESlot = document.getElementById("bullet-e-slot")!;
  const bulletFSlot = document.getElementById("bullet-f-slot")!;
  const statusCol = document.getElementById("status-led-col")!;
  const kbRoot = document.getElementById("hex-keyboard-root")!;
  const lcdRoot = document.getElementById("lcd1602-root")!;

  for (let i = 0; i < 8; i++) {
    const el = createSevenSegment({
      value: "0",
      color: ADDR_COLOR,
      backgroundColor: "#1a0d0b",
      width: 30,
      height: 60,
      thickness: 6,
    });
    addrEls.push(el);
    addrBank.appendChild(el);
  }
  for (let i = 0; i < 4; i++) {
    const el = createSevenSegment({
      value: "0",
      color: ADDR_COLOR,
      backgroundColor: "#1a0d0b",
      width: 30,
      height: 60,
      thickness: 6,
    });
    dataEls.push(el);
    dataBank.appendChild(el);
  }

  // RUN=青 / HALT=黄 / UNDEF=赤 — DATA 右
  const run = createBulletItem(0xc, {
    labelText: "RUN",
    labelAfter: true,
    color: "blue",
  });
  const halt = createBulletItem(0xd, {
    labelText: "HALT",
    labelAfter: true,
    color: "yellow",
  });
  const undef = createBulletItem(0xb, {
    labelText: "UNDEF",
    labelAfter: true,
    color: "red",
  });
  statusCol.appendChild(run.item);
  statusCol.appendChild(halt.item);
  statusCol.appendChild(undef.item);

  // 0–A: 通常行 / B: UNDEF / C·D: RUN·HALT / E: ADDR下 / F: DATA下
  for (let i = 0; i < 16; i++) {
    if (i === 0xb) {
      bulletEls.push(undef.led);
      continue;
    }
    if (i === 0xc) {
      bulletEls.push(run.led);
      continue;
    }
    if (i === 0xd) {
      bulletEls.push(halt.led);
      continue;
    }
    const focus = i === 0xe || i === 0xf;
    const { item, led } = createBulletItem(i, { showLabel: !focus });
    bulletEls.push(led);
    if (i === 0xe) bulletESlot.appendChild(item);
    else if (i === 0xf) bulletFSlot.appendChild(item);
    else bulletRow.appendChild(item);
  }

  lcdView = mountLcd1602(lcdRoot);

  mountHexKeyboard(kbRoot, {
    onHexClick: (v) => window.emuApi.keyHex(v),
    onFunctionClick: (fn) => window.emuApi.keyFn(fn),
    onFunctionLongPress: (fn) => {
      if (fn === "F0") window.emuApi.keyAdsLongPress();
    },
    functionLabels: FN_KEY_LABELS,
  });
}

/**
 * スナップショットを画面へ反映する。
 * 表示は LED ラッチ（ハンドシェイク 0x16 / パネル操作）由来で、メモリは覗かない。
 * @param snap メインプロセスから届いた最新状態
 */
function renderSnapshot(snap: EmuSnapshotWire): void {
  const segs = snap.led?.sevenSeg ?? [];
  for (let i = 0; i < 8; i++) {
    setSevenSegmentPattern(addrEls[i]!, segs[i] ?? 0, ADDR_COLOR);
  }
  for (let i = 0; i < 4; i++) {
    setSevenSegmentPattern(dataEls[i]!, segs[8 + i] ?? 0, ADDR_COLOR);
  }

  const lo = snap.led?.bulletLed0_7 ?? 0;
  const hi = snap.led?.bulletLed8_F ?? 0;
  for (let i = 0; i < 16; i++) {
    const on = i < 8 ? ((lo >> i) & 1) !== 0 : ((hi >> (i - 8)) & 1) !== 0;
    setLedOn(bulletEls[i]!, on);
  }

  lcdView?.render(snap.lcd);
}

initDom();
window.emuApi.onSnapshot(renderSnapshot);
void window.emuApi.getSnapshot().then(renderSnapshot);
