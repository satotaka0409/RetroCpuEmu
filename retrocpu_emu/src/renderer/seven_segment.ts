/** 7セグメント 1桁（旧 React SevenSegment と同等） */

const SEGMENTS: Record<string, number[]> = {
  "0": [1, 1, 1, 1, 1, 1, 0],
  "1": [0, 1, 1, 0, 0, 0, 0],
  "2": [1, 1, 0, 1, 1, 0, 1],
  "3": [1, 1, 1, 1, 0, 0, 1],
  "4": [0, 1, 1, 0, 0, 1, 1],
  "5": [1, 0, 1, 1, 0, 1, 1],
  "6": [1, 0, 1, 1, 1, 1, 1],
  "7": [1, 1, 1, 0, 0, 0, 0],
  "8": [1, 1, 1, 1, 1, 1, 1],
  "9": [1, 1, 1, 1, 0, 1, 1],
  A: [1, 1, 1, 0, 1, 1, 1],
  B: [0, 0, 1, 1, 1, 1, 1],
  C: [1, 0, 0, 1, 1, 1, 0],
  D: [0, 1, 1, 1, 1, 0, 1],
  E: [1, 0, 0, 1, 1, 1, 1],
  F: [1, 0, 0, 0, 1, 1, 1],
};

export type SevenSegmentOpts = {
  value: string;
  color?: string;
  backgroundColor?: string;
  thickness?: number;
  width?: number;
  height?: number;
  decimalPoint?: boolean;
};

/**
 * 7セグメント 1 桁分の要素を作る。
 * @param opts 表示文字・色・サイズ・小数点の有無
 * @returns セグメント要素を内包したラッパ要素
 */
export function createSevenSegment(opts: SevenSegmentOpts): HTMLElement {
  const color = opts.color ?? "#f00";
  const backgroundColor = opts.backgroundColor ?? "#111";
  const thickness = opts.thickness ?? 8;
  const width = opts.width ?? 40;
  const height = opts.height ?? 80;
  const decimalPoint = opts.decimalPoint ?? false;
  const pattern = SEGMENTS[opts.value.toUpperCase()] ?? [0, 0, 0, 0, 0, 0, 0];

  const root = document.createElement("div");
  root.className = "seven-segment";
  root.style.cssText = `position:relative;width:${width}px;height:${height}px;background:${backgroundColor};border-radius:${thickness}px;display:inline-block;`;

  const segs = [
    { left: thickness, top: 0, w: width - 2 * thickness, h: thickness },
    {
      left: width - thickness,
      top: thickness,
      w: thickness,
      h: height / 2 - thickness,
    },
    {
      left: width - thickness,
      top: height / 2,
      w: thickness,
      h: height / 2 - thickness,
    },
    {
      left: thickness,
      top: height - thickness,
      w: width - 2 * thickness,
      h: thickness,
    },
    {
      left: 0,
      top: height / 2,
      w: thickness,
      h: height / 2 - thickness,
    },
    { left: 0, top: thickness, w: thickness, h: height / 2 - thickness },
    {
      left: thickness,
      top: height / 2 - thickness / 2,
      w: width - 2 * thickness,
      h: thickness,
    },
    {
      left: width - thickness * 1.2 + 8,
      top: height - thickness * 1.2 + 8,
      w: thickness * 0.8,
      h: thickness * 0.8,
      dot: true,
    },
  ];

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const el = document.createElement("div");
    const isDot = Boolean(seg.dot);
    const on = isDot ? decimalPoint : Boolean(pattern[i]);
    el.className = "segment" + (isDot ? " segment-dot" : "");
    el.style.cssText = [
      "position:absolute",
      `left:${seg.left}px`,
      `top:${seg.top}px`,
      `width:${seg.w}px`,
      `height:${seg.h}px`,
      `background:${on ? color : "#333"}`,
      `border-radius:${isDot ? "50%" : thickness / 2 + "px"}`,
      "transition:background 0.2s",
      `opacity:${on ? 1 : 0.2}`,
    ].join(";");
    root.appendChild(el);
  }

  return root;
}

/**
 * 表示文字を指定して 7セグを更新する。
 * @param root createSevenSegment() が返した要素
 * @param value 表示する 1 文字（未知の文字は全消灯）
 * @param color 点灯色
 */
export function setSevenSegmentValue(
  root: HTMLElement,
  value: string,
  color = "#ff3b1f",
): void {
  const pattern = SEGMENTS[value.toUpperCase()] ?? [0, 0, 0, 0, 0, 0, 0];
  setSevenSegmentPattern(
    root,
    pattern.reduce((acc, bit, i) => acc | (bit ? 1 << i : 0), 0),
    color,
  );
}

/**
 * ハンドシェイク LED 表示のビットパターンで点灯する。
 * bit0..6 = a..g, bit7 = dp
 */
export function setSevenSegmentPattern(
  root: HTMLElement,
  bits: number,
  color = "#ff3b1f",
): void {
  const segs = root.querySelectorAll<HTMLElement>(".segment");
  segs.forEach((el, i) => {
    const on = ((bits >> i) & 1) !== 0;
    el.style.background = on ? color : "#333";
    el.style.opacity = on ? "1" : "0.2";
  });
}
