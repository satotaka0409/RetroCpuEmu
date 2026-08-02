import React from "react";

export type LedColor = "red" | "blue" | "yellow" | "orange" | "white";

export type LedProps = {
  on?: boolean;
  color?: LedColor;
  size?: number;
  className?: string;
};

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

/**
 * 単一コアの丸型LED。
 * 色は `color` パラメータで切り替える。
 */
export const Led: React.FC<LedProps> = ({
  on = false,
  color = "red",
  size = 12,
  className,
}) => {
  const tone = LED_TONES[color];

  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-block",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        background: on
          ? `radial-gradient(circle at 35% 30%, ${tone.onCenter} 0%, ${tone.onEdge} 62%, #000 100%)`
          : tone.off,
        boxShadow: on
          ? `0 0 ${Math.max(6, size * 0.75)}px ${tone.glow}`
          : "none",
        transition: "background 0.18s ease, box-shadow 0.18s ease",
      }}
    />
  );
};
