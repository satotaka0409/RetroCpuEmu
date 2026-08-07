import React from "react";
import "./HexKeyboard.css";

export type HexKeyboardProps = {
  onHexClick?: (value: string) => void;
  onFunctionClick?: (fn: string) => void;
};

const hexKeys: string[][] = [
  ["C", "D", "E", "F"],
  ["8", "9", "A", "B"],
  ["4", "5", "6", "7"],
  ["0", "1", "2", "3"],
];

const functionKeys: string[] = [
  "F0",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
];

export const HexKeyboard: React.FC<HexKeyboardProps> = ({
  onHexClick,
  onFunctionClick,
}) => {
  return (
    <div className="hex-keyboard-root">
      <div className="hex-keyboard">
        {hexKeys.map((row, y) => (
          <div className="hex-key-row" key={y}>
            {row.map((key) => (
              <button
                className="hex-key"
                key={key}
                type="button"
                onClick={() => onHexClick && onHexClick(key)}
              >
                {key}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="function-keys function-keys-grid">
        {[0, 1, 2, 3].map((row) => (
          <div className="function-key-row" key={row}>
            {functionKeys.slice(row * 2, row * 2 + 2).map((fn) => (
              <button
                className="function-key"
                key={fn}
                type="button"
                onClick={() => onFunctionClick && onFunctionClick(fn)}
              >
                {fn}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
