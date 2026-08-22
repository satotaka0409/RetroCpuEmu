/**
 * TMS9995 内蔵タイマー CRU フラグ（1EE0/1EE1）の単体試験。
 * 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc / boot_monitor.mdc
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getDecrementerEnabled,
  notifyCruFlagWrite,
  readCruTimerFlagBit,
  resetCruTimerFlags,
  setDecrementerEnabled,
} from "../../../src/cpuboard/tms9995/cru_timer";

describe("TMS9995 cru_timer", () => {
  beforeEach(() => {
    resetCruTimerFlags();
  });

  it("初期状態では 1EE1 は 0、デクリメンタ無効", () => {
    expect(readCruTimerFlagBit(0x1ee1)).toBe(0);
    expect(getDecrementerEnabled()).toBe(false);
  });

  it("1EE1 への SBO 相当でデクリメンタ有効になる", () => {
    notifyCruFlagWrite(0x1ee1, 1);
    expect(readCruTimerFlagBit(0x1ee1)).toBe(1);
    expect(getDecrementerEnabled()).toBe(true);
  });

  it("1EE1 への SBZ 相当でデクリメンタ無効になる", () => {
    notifyCruFlagWrite(0x1ee1, 1);
    notifyCruFlagWrite(0x1ee1, 0);
    expect(readCruTimerFlagBit(0x1ee1)).toBe(0);
    expect(getDecrementerEnabled()).toBe(false);
  });

  it("1EE0 への書込は FLAG1 状態を変えない", () => {
    notifyCruFlagWrite(0x1ee0, 1);
    expect(readCruTimerFlagBit(0x1ee1)).toBe(0);
    expect(getDecrementerEnabled()).toBe(false);
  });

  it("未対応 CRU アドレスは常に 0", () => {
    notifyCruFlagWrite(0x1ee1, 1);
    expect(readCruTimerFlagBit(0x0020)).toBe(0);
    expect(readCruTimerFlagBit(0x1ee0)).toBe(0);
  });

  it("setDecrementerEnabled はテスト用に状態を直接設定できる", () => {
    setDecrementerEnabled(true);
    expect(getDecrementerEnabled()).toBe(true);
    expect(readCruTimerFlagBit(0x1ee1)).toBe(1);
  });

  it("resetCruTimerFlags で状態がクリアされる", () => {
    notifyCruFlagWrite(0x1ee1, 1);
    resetCruTimerFlags();
    expect(getDecrementerEnabled()).toBe(false);
    expect(readCruTimerFlagBit(0x1ee1)).toBe(0);
  });
});
