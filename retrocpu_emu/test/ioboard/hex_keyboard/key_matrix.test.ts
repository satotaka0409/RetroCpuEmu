/**
 * 14h キー行列（HandShake.mdc Bit3–0）
 */
import { describe, expect, it } from "vitest";
import { panelKeyColumnMask } from "../../../src/ioboard/hex_keyboard/key_matrix";
import {
  createIoBoardCommandState,
  setPanelKeyHeld,
} from "../../../src/ioboard/handshake/io_board_mock";

describe("hex key matrix (HandShake.mdc)", () => {
  it("列0–3 の Bit3–0 は C 8 4 0 / D 9 5 1 / E A 6 2 / F B 7 3", () => {
    expect(panelKeyColumnMask("C")).toEqual({ col: 0, mask: 0x08 });
    expect(panelKeyColumnMask("8")).toEqual({ col: 0, mask: 0x04 });
    expect(panelKeyColumnMask("4")).toEqual({ col: 0, mask: 0x02 });
    expect(panelKeyColumnMask("0")).toEqual({ col: 0, mask: 0x01 });
    expect(panelKeyColumnMask("1")).toEqual({ col: 1, mask: 0x01 });
    expect(panelKeyColumnMask("7")).toEqual({ col: 3, mask: 0x02 });
    expect(panelKeyColumnMask("F")).toEqual({ col: 3, mask: 0x08 });
  });

  it("列4–5 の Bit3–0 は F0 F2 F4 F6 / F1 F3 F5 F7", () => {
    expect(panelKeyColumnMask("F0")).toEqual({ col: 4, mask: 0x08 });
    expect(panelKeyColumnMask("F2")).toEqual({ col: 4, mask: 0x04 });
    expect(panelKeyColumnMask("F4")).toEqual({ col: 4, mask: 0x02 });
    expect(panelKeyColumnMask("F6")).toEqual({ col: 4, mask: 0x01 });
    expect(panelKeyColumnMask("F1")).toEqual({ col: 5, mask: 0x08 });
    expect(panelKeyColumnMask("F7")).toEqual({ col: 5, mask: 0x01 });
  });

  it("モニターでも押下ビットは保持する（14h はフリー時だけ返す）", () => {
    const state = createIoBoardCommandState();
    setPanelKeyHeld(state, "0", true);
    expect(state.hexKeys[0]).toBe(0x01);
  });

  it("押下ビットを列に立てて離すと落とす", () => {
    const state = createIoBoardCommandState();
    setPanelKeyHeld(state, "0", true);
    setPanelKeyHeld(state, "C", true);
    setPanelKeyHeld(state, "F0", true);
    expect(state.hexKeys[0]).toBe(0x09);
    expect(state.hexKeys[4]).toBe(0x08);
    expect(state.hexKeys[6]).toBe(0);
    expect(state.hexKeys[7]).toBe(0);
    setPanelKeyHeld(state, "0", false);
    expect(state.hexKeys[0]).toBe(0x08);
  });
});
