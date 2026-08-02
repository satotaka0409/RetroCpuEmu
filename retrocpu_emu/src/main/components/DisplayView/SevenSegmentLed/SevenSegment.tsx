import React from "react";
import "./SevenSegment.css";

export type SevenSegmentProps = {
  /** 表示する値（0-15 or 0-F） */
  value: string;
  /** 表示するパターン　*/
  pattern?: number[];
  /** 点灯色（デフォルト: 赤） */
  color?: string;
  /** 背景色（デフォルト: 黒） */
  backgroundColor?: string;
  /** セグメントの太さ（px, デフォルト: 8） */
  thickness?: number;
  /** セグメントの幅（px, デフォルト: 40） */
  width?: number;
  /** セグメントの高さ（px, デフォルト: 80） */
  height?: number;
  /** 小数点を点灯するか */
  decimalPoint?: boolean;
};

// 各数字/16進文字ごとのセグメント点灯パターン（a-g, dp）
// [a, b, c, d, e, f, g]
const SEGMENTS: Record<
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F",
  number[]
> = {
  "0": [1, 1, 1, 1, 1, 1, 0], // 0
  "1": [0, 1, 1, 0, 0, 0, 0], // 1
  "2": [1, 1, 0, 1, 1, 0, 1], // 2
  "3": [1, 1, 1, 1, 0, 0, 1], // 3
  "4": [0, 1, 1, 0, 0, 1, 1], // 4
  "5": [1, 0, 1, 1, 0, 1, 1], // 5
  "6": [1, 0, 1, 1, 1, 1, 1], // 6
  "7": [1, 1, 1, 0, 0, 0, 0], // 7
  "8": [1, 1, 1, 1, 1, 1, 1], // 8
  "9": [1, 1, 1, 1, 0, 1, 1], // 9
  A: [1, 1, 1, 0, 1, 1, 1], // A
  B: [0, 0, 1, 1, 1, 1, 1], // B
  C: [1, 0, 0, 1, 1, 1, 0], // C
  D: [0, 1, 1, 1, 1, 0, 1], // D
  E: [1, 0, 0, 1, 1, 1, 1], // E
  F: [1, 0, 0, 0, 1, 1, 1], // F
};

/**
 * 7セグメントLED 1桁表示コンポーネント
 */
export const SevenSegment: React.FC<SevenSegmentProps> = ({
  value,
  pattern = null,
  color = "#f00",
  backgroundColor = "#111",
  thickness = 8,
  width = 40,
  height = 80,
  decimalPoint = false,
}) => {
  type SegmentKey = keyof typeof SEGMENTS;
  let key = null;
  let pattern_ = null;

  if (value != null) {
    key = value.toUpperCase() as SegmentKey;
    pattern_ = SEGMENTS[key];
  } else if (pattern != null) {
    pattern_ = pattern;
  } else {
    throw new Error("value or pattern is required");
  }
  // セグメントの座標・サイズ
  const segs = [
    // a
    {
      left: thickness,
      top: 0,
      w: width - 2 * thickness,
      h: thickness,
      rotate: 0,
    },
    // b
    {
      left: width - thickness,
      top: thickness,
      w: thickness,
      h: height / 2 - thickness,
      rotate: 0,
    },
    // c
    {
      left: width - thickness,
      top: height / 2,
      w: thickness,
      h: height / 2 - thickness,
      rotate: 0,
    },
    // d
    {
      left: thickness,
      top: height - thickness,
      w: width - 2 * thickness,
      h: thickness,
      rotate: 0,
    },
    // e
    {
      left: 0,
      top: height / 2,
      w: thickness,
      h: height / 2 - thickness,
      rotate: 0,
    },
    // f
    {
      left: 0,
      top: thickness,
      w: thickness,
      h: height / 2 - thickness,
      rotate: 0,
    },
    // g
    {
      left: thickness,
      top: height / 2 - thickness / 2,
      w: width - 2 * thickness,
      h: thickness,
      rotate: 0,
    },
    // 小数点
    {
      left: width - thickness * 1.2 + 8,
      top: height - thickness * 1.2 + 8,
      w: thickness * 0.8,
      h: thickness * 0.8,
      rotate: 0,
    },
  ];
  return (
    <div
      className="seven-segment"
      style={{
        position: "relative",
        width,
        height,
        background: backgroundColor,
        borderRadius: thickness,
        display: "inline-block",
      }}
    >
      {segs.map((seg, i) => (
        <div
          key={i}
          className={"segment" + (i === 7 ? " segment-dot" : "")}
          style={{
            position: "absolute",
            left: seg.left,
            top: seg.top,
            width: seg.w,
            height: seg.h,
            background:
              i === 7
                ? decimalPoint
                  ? color
                  : "#333"
                : pattern_ != null && pattern_[i]
                  ? color
                  : "#333",
            borderRadius: i === 7 ? "50%" : thickness / 2,
            transition: "background 0.2s",
            opacity:
              i === 7
                ? decimalPoint
                  ? 1
                  : 0.2
                : pattern_ != null && pattern_[i]
                  ? 1
                  : 0.2,
          }}
        />
      ))}
    </div>
  );
};
