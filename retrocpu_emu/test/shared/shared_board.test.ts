/**
 * SharedArrayBuffer スロットと 64bit クロックの hi/lo 変換
 */

import { describe, it, expect } from "vitest";
import {
  clockCountFromHiLo,
  clockCountToHiLo,
  STATUS,
} from "../../src/shared/shared_board";

describe("clockCount hi/lo", () => {
  it("0 と小さな値を往復できる", () => {
    expect(clockCountFromHiLo(0, 0)).toBe(0n);
    const small = clockCountToHiLo(4n);
    expect(small.hi).toBe(0);
    expect(small.lo).toBe(4);
    expect(clockCountFromHiLo(small.hi, small.lo)).toBe(4n);
  });

  it("2^32 をまたいでも往復できる", () => {
    const n = 0x1_0000_0000n + 7n;
    const { hi, lo } = clockCountToHiLo(n);
    expect(clockCountFromHiLo(hi, lo)).toBe(n);
  });

  it("64bit 最大値をラップせず復元できる", () => {
    const max = 0xffff_ffff_ffff_ffffn;
    const { hi, lo } = clockCountToHiLo(max);
    expect(clockCountFromHiLo(hi, lo)).toBe(max);
  });

  it("STATUS.CLOCK_* は OSR の直後", () => {
    expect(STATUS.CLOCK_LO).toBe(STATUS.OSR3 + 1);
    expect(STATUS.CLOCK_HI).toBe(STATUS.CLOCK_LO + 1);
  });
});
