import React from "react";
import { SevenSegment } from "./SevenSegmentLed/SevenSegment";
import { Led, type LedColor } from "./Led/Led";

type DisplayViewProps = {
  address?: string | number;
  data?: string | number;
  status?: boolean[];
  statusColors?: LedColor[];
};

const normalizeHex = (
  value: string | number | undefined,
  digits: number,
): string[] => {
  const normalized =
    typeof value === "number"
      ? value.toString(16).toUpperCase()
      : (value ?? "")
          .toString()
          .toUpperCase()
          .replace(/[^0-9A-F]/g, "");

  return normalized.padStart(digits, "0").slice(-digits).split("");
};

const statusDefault: boolean[] = Array.from({ length: 8 }, () => false);
const statusColorDefault: LedColor[] = [
  "red",
  "red",
  "yellow",
  "yellow",
  "blue",
  "blue",
  "white",
  "orange",
];

const DisplayView: React.FC<DisplayViewProps> = ({
  address = "000000",
  data = "0000",
  status = statusDefault,
  statusColors = statusColorDefault,
}) => {
  const addressDigits: string[] = normalizeHex(address, 6);
  const dataDigits: string[] = normalizeHex(data, 4);
  const statusValues: boolean[] = Array.from(
    { length: 8 },
    (_, i) => status[i] ?? false,
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 12,
        background: "#0e1014",
        borderRadius: 8,
        width: "fit-content",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p style={{ margin: 0, color: "#d8deea", fontSize: 12 }}>ADDRESS</p>
          <div style={{ display: "flex", gap: 6 }}>
            {addressDigits.map((digit, index) => (
              <SevenSegment key={`addr-${index}`} value={digit} />
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginLeft: 32,
          }}
        >
          <p style={{ margin: 0, color: "#d8deea", fontSize: 12 }}>DATA</p>
          <div style={{ display: "flex", gap: 6 }}>
            {dataDigits.map((digit, index) => (
              <SevenSegment key={`data-${index}`} value={digit} />
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 12,
          paddingTop: 4,
        }}
      >
        {statusValues.map((on, index) => (
          <Led
            key={`status-${index}`}
            on={on}
            color={statusColors[index] ?? "red"}
            size={14}
          />
        ))}
      </div>
    </div>
  );
};

export default DisplayView;
