/**
 * IOボード画面
 * ファンクションキーは ioboard.mdc（ADS/RD/INC/DEC/WINC/RUN/H/ST/RST）。
 * パネル LED はコンソールが駆動。ユーザープログラムの 0x16 も同じラッチを使う。
 */

import {
  createSevenSegment,
  setSevenSegmentPattern,
} from "./seven_segment";
import { createLed, setLedOn } from "./led";
import { mountHexKeyboard } from "./hex_keyboard";
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

function initDom(): void {
  const addrBank = document.getElementById("addr-bank")!;
  const dataBank = document.getElementById("data-bank")!;
  const bulletRow = document.getElementById("bullet-row")!;
  const kbRoot = document.getElementById("hex-keyboard-root")!;

  for (let i = 0; i < 8; i++) {
    const el = createSevenSegment({
      value: "0",
      color: ADDR_COLOR,
      backgroundColor: "#1a0d0b",
      width: 28,
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
      width: 28,
      height: 60,
      thickness: 6,
    });
    dataEls.push(el);
    dataBank.appendChild(el);
  }
  for (let i = 0; i < 16; i++) {
    const item = document.createElement("div");
    item.className = "bullet-led-item";
    const label = document.createElement("span");
    label.className = "bullet-led-label";
    label.textContent = i.toString(16).toUpperCase();
    const led = createLed(i < 8 ? "red" : "orange", 12);
    bulletEls.push(led);
    item.appendChild(label);
    item.appendChild(led);
    bulletRow.appendChild(item);
  }

  mountHexKeyboard(kbRoot, {
    onHexClick: (v) => window.emuApi.keyHex(v),
    onFunctionClick: (fn) => window.emuApi.keyFn(fn),
    functionLabels: FN_KEY_LABELS,
  });
}

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
}

initDom();
window.emuApi.onSnapshot(renderSnapshot);
void window.emuApi.getSnapshot().then(renderSnapshot);
