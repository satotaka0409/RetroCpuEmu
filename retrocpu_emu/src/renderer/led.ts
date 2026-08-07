/** 砲弾 LED（旧 React Led と同等の見た目） */

export type LedColor = "red" | "blue" | "yellow" | "orange" | "white";

type LedTone = {
  onCenter: string;
  onEdge: string;
  off: string;
  glow: string;
};

const LED_TONES: Record<LedColor, LedTone> = {
  red: {
    onCenter: "#ff8787",
    onEdge: "#ff4040",
    off: "#5c4747",
    glow: "rgba(255, 64, 64, 0.9)",
  },
  blue: {
    onCenter: "#8fd1ff",
    onEdge: "#1f8fff",
    off: "#445664",
    glow: "rgba(31, 143, 255, 0.9)",
  },
  yellow: {
    onCenter: "#fff4a6",
    onEdge: "#ffd94a",
    off: "#665f46",
    glow: "rgba(255, 217, 74, 0.95)",
  },
  orange: {
    onCenter: "#ffd0a4",
    onEdge: "#ff9a3d",
    off: "#655345",
    glow: "rgba(255, 154, 61, 0.9)",
  },
  white: {
    onCenter: "#ffffff",
    onEdge: "#f0f4ff",
    off: "#64676d",
    glow: "rgba(245, 248, 255, 0.95)",
  },
};

export function createLed(
  color: LedColor = "red",
  size = 12,
): HTMLSpanElement {
  const el = document.createElement("span");
  el.dataset.color = color;
  el.dataset.size = String(size);
  setLedOn(el, false);
  return el;
}

export function setLedOn(el: HTMLSpanElement, on: boolean): void {
  const color = (el.dataset.color as LedColor) || "red";
  const size = Number(el.dataset.size || 12);
  const tone = LED_TONES[color];
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:50%",
    "display:inline-block",
    "border:1px solid rgba(255,255,255,0.2)",
    on
      ? `background:radial-gradient(circle at 35% 30%, ${tone.onCenter} 0%, ${tone.onEdge} 62%, #000 100%)`
      : `background:${tone.off}`,
    on
      ? `box-shadow:0 0 ${Math.max(6, size * 0.75)}px ${tone.glow}`
      : "box-shadow:none",
    "transition:background 0.18s ease, box-shadow 0.18s ease",
  ].join(";");
}
