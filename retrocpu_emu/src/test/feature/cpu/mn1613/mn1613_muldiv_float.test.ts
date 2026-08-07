/**
 * MN1613 乗算 / 除算 / 浮動小数点 命令テスト
 *
 * 根拠: .cursor/rules/MN1613.mdc
 *   M  `01111 111 kkkk 11ii`  DR0 ← R0 × (Ri)     符号なし 16×16→32
 *   D  `01110 111 kkkk 11ii`  R0←商, R1←余り      符号なし 32÷16
 *   FA `01101 111 kkkk 11ii`  DR0 ← DR0 + ((Ri))
 *   FS `01101 111 kkkk 01ii`  DR0 ← DR0 - ((Ri))
 *   FM `01100 111 kkkk 11ii`  DR0 ← DR0 × ((Ri))
 *   FD `01100 111 kkkk 01ii`  DR0 ← DR0 / ((Ri))
 *   FIX`00011 111 kkkk 01ii`  R0 ← int(DR0)
 *   FLT`00011 111 kkkk 11ii`  DR0 ← float(R0)
 *
 * IBM hex float: S(1) + exp(7, bias 40H=16^0) + mant(24), 基数16
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  reset,
  getState,
  setMemory,
  run,
  clearBreakpoints,
  STR_E,
  STR_OVF,
} from "../../../../main/feature/cpu/mn1613/mn1613";

/**
 * 新しいメモリを用意し、ワード列を 0 番地から並べる。
 * @param words 命令／データのワード列
 */
function loadWords(words: number[]): void {
  const buf = new ArrayBuffer(0x20000);
  const view = new DataView(buf);
  for (let i = 0; i < words.length; i++) {
    view.setUint16(i * 2, words[i]! & 0xffff, false);
  }
  setMemory(buf);
}

/**
 * ワード列をロードして 0 番地から HALT まで実行する。
 * @param words 命令／データのワード列（末尾に H を置く想定）
 * @param maxCycles 最大サイクル数
 * @returns 停止時点のレジスタ
 */
async function runHalt(
  words: number[],
  maxCycles = 5000,
): Promise<ReturnType<typeof getState>> {
  loadWords(words);
  await run(0, maxCycles);
  return getState();
}

/** IBM hex float を手計算でエンコード（テスト期待値用） */
function ibmHex(v: number): [number, number] {
  if (v === 0) return [0, 0];
  const sign = v < 0 ? 1 : 0;
  const abs = Math.abs(v);
  let exp = Math.floor(Math.log(abs) / Math.log(16)) + 65;
  let mant = Math.round(abs * Math.pow(16, 70 - exp));
  while (mant < 0x100000 && exp > 0) {
    mant *= 16;
    exp--;
  }
  while (mant >= 0x1000000 && exp < 127) {
    mant = Math.floor(mant / 16);
    exp++;
  }
  mant &= 0xffffff;
  const w0 = (sign << 15) | ((exp & 0x7f) << 8) | ((mant >>> 16) & 0xff);
  const w1 = mant & 0xffff;
  return [w0, w1];
}

/**
 * IBM hex float の 2 語を JS の number に戻す（実行結果の確認用）。
 * @param w0 符号・指数・仮数上位
 * @param w1 仮数下位
 * @returns 復元した値
 */
function decodeIbm(w0: number, w1: number): number {
  if ((w0 | w1) === 0) return 0;
  const sign = w0 >>> 15;
  const exp = (w0 >>> 8) & 0x7f;
  const mant = ((w0 & 0xff) << 16) | (w1 & 0xffff);
  const val = mant * Math.pow(16, exp - 70);
  return sign ? -val : val;
}

beforeEach(() => {
  reset();
  clearBreakpoints();
});

// ─────────────────────────────────────────────
// M（符号なし乗算）
// ─────────────────────────────────────────────
describe("M 命令（符号なし 16×16→32）", () => {
  it("3 × 4 = 12", async () => {
    const words = new Array(0x80).fill(0);
    words[0x50] = 4;
    words[0] = 0x7807;
    words[1] = 3; // MVWI R0, 3
    words[2] = 0x7907;
    words[3] = 0x0050; // MVWI R1, ptr
    words[4] = 0x7f0c; // M DR0, (R1)  kkkk=0 ii=0
    words[5] = 0x2000; // H
    const s = await runHalt(words);
    expect(s.R[0]).toBe(0);
    expect(s.R[1]).toBe(12);
    expect(s.STR & STR_E).toBe(0);
    expect(s.STR & STR_OVF).toBe(0);
  });

  it("0xFFFF × 0xFFFF = 0xFFFE0001", async () => {
    const words = new Array(0x80).fill(0);
    words[0x50] = 0xffff;
    words[0] = 0x7807;
    words[1] = 0xffff;
    words[2] = 0x7907;
    words[3] = 0x0050;
    words[4] = 0x7f0c; // M
    words[5] = 0x2000;
    const s = await runHalt(words);
    expect(s.R[0]).toBe(0xfffe);
    expect(s.R[1]).toBe(0x0001);
  });

  it("0 × n = 0", async () => {
    const words = new Array(0x80).fill(0);
    words[0x50] = 0x1234;
    words[0] = 0x7807;
    words[1] = 0;
    words[2] = 0x7907;
    words[3] = 0x0050;
    words[4] = 0x7f0c;
    words[5] = 0x2000;
    const s = await runHalt(words);
    expect(s.R[0]).toBe(0);
    expect(s.R[1]).toBe(0);
  });
});

// ─────────────────────────────────────────────
// D（符号なし除算）
// ─────────────────────────────────────────────
describe("D 命令（符号なし 32÷16）", () => {
  it("10 ÷ 3 → 商3 余り1", async () => {
    const words = new Array(0x80).fill(0);
    words[0x50] = 3;
    words[0] = 0x7807;
    words[1] = 0; // R0 MSB
    words[2] = 0x7907;
    words[3] = 10; // R1 LSB
    words[4] = 0x7a07;
    words[5] = 0x0050; // R2 = ptr
    words[6] = 0x770d; // D DR0, (R2)
    words[7] = 0x2000;
    const s = await runHalt(words);
    expect(s.R[0]).toBe(3);
    expect(s.R[1]).toBe(1);
    expect(s.STR & STR_OVF).toBe(0);
    expect(s.STR & STR_E).toBe(0);
  });

  it("0x10000 ÷ 2 = 0x8000", async () => {
    const words = new Array(0x80).fill(0);
    words[0x50] = 2;
    words[0] = 0x7807;
    words[1] = 1; // 0x00010000
    words[2] = 0x7907;
    words[3] = 0;
    words[4] = 0x7a07;
    words[5] = 0x0050;
    words[6] = 0x770d;
    words[7] = 0x2000;
    const s = await runHalt(words);
    expect(s.R[0]).toBe(0x8000);
    expect(s.R[1]).toBe(0);
  });

  it("除数 0 → V=1", async () => {
    const words = new Array(0x80).fill(0);
    words[0x50] = 0;
    words[0] = 0x7807;
    words[1] = 0;
    words[2] = 0x7907;
    words[3] = 100;
    words[4] = 0x7a07;
    words[5] = 0x0050;
    words[6] = 0x770d;
    words[7] = 0x2000;
    const s = await runHalt(words);
    expect(s.STR & STR_OVF).toBe(STR_OVF);
  });

  it("商が 16bit を超える → V=1", async () => {
    // 0x00020000 ÷ 1 = 0x20000 > 0xFFFF
    const words = new Array(0x80).fill(0);
    words[0x50] = 1;
    words[0] = 0x7807;
    words[1] = 2;
    words[2] = 0x7907;
    words[3] = 0;
    words[4] = 0x7a07;
    words[5] = 0x0050;
    words[6] = 0x770d;
    words[7] = 0x2000;
    const s = await runHalt(words);
    expect(s.STR & STR_OVF).toBe(STR_OVF);
  });
});

// ─────────────────────────────────────────────
// FLT / FIX
// ─────────────────────────────────────────────
describe("FLT / FIX", () => {
  it("FLT: 整数 5 → IBM float、FIX で戻る", async () => {
    const [h, l] = ibmHex(5);
    const words: number[] = [
      0x7807,
      5, // MVWI R0, 5
      0x1f0c, // FLT (kkkk=0)
      0x2000, // H
    ];
    const s = await runHalt(words);
    expect(s.R[0]).toBe(h);
    expect(s.R[1]).toBe(l);
    expect(decodeIbm(s.R[0], s.R[1])).toBe(5);
  });

  it("FIX: float(42) → 42", async () => {
    const [h, l] = ibmHex(42);
    const words: number[] = [
      0x7807,
      h, // R0
      0x7907,
      l, // R1
      0x1f04, // FIX
      0x2000,
    ];
    const s = await runHalt(words);
    expect(s.R[0]).toBe(42);
    expect(s.STR & STR_OVF).toBe(0);
  });

  it("FIX: 範囲外 → V=1", async () => {
    const [h, l] = ibmHex(100000);
    const words: number[] = [0x7807, h, 0x7907, l, 0x1f04, 0x2000];
    const s = await runHalt(words);
    expect(s.STR & STR_OVF).toBe(STR_OVF);
  });

  it("FLT: 負数 -7", async () => {
    const words: number[] = [
      0x7807,
      0xfff9, // -7
      0x1f0c, // FLT
      0x2000,
    ];
    const s = await runHalt(words);
    expect(decodeIbm(s.R[0], s.R[1])).toBe(-7);
    expect(s.R[0] & 0x8000).toBe(0x8000);
  });
});

// ─────────────────────────────────────────────
// FA / FS / FM / FD
// ─────────────────────────────────────────────
describe("FA / FS / FM / FD（浮動小数点四則）", () => {
  /** DR0=a, mem[0x50]=b を置いて op を実行 */
  async function fpOp(
    a: number,
    b: number,
    opcode: number,
  ): Promise<ReturnType<typeof getState>> {
    const [ah, al] = ibmHex(a);
    const [bh, bl] = ibmHex(b);
    const words = new Array(0xa0).fill(0);
    words[0x50] = bh;
    words[0x51] = bl;
    words[0] = 0x7807;
    words[1] = ah;
    words[2] = 0x7907;
    words[3] = al;
    words[4] = 0x7a07;
    words[5] = 0x0050; // R2 = ptr
    // ii=1 → R2: opcode の下位 2bit を 01 に（呼び出し側で合わせる）
    words[6] = opcode;
    words[7] = 0x2000;
    return runHalt(words);
  }

  it("FA: 1.5 + 2.5 = 4", async () => {
    // FA DR0,(R2) = 0x6F0D (op=0x0D rrr=7 lo=kkkk<<4|1101 = 0x0D)
    const s = await fpOp(1.5, 2.5, 0x6f0d);
    expect(decodeIbm(s.R[0], s.R[1])).toBeCloseTo(4, 5);
    expect(s.STR & STR_E).toBe(0);
    expect(s.STR & STR_OVF).toBe(0);
  });

  it("FS: 10 - 3 = 7", async () => {
    // FS = 0x6F05 (lo=0101)
    const s = await fpOp(10, 3, 0x6f05);
    expect(decodeIbm(s.R[0], s.R[1])).toBeCloseTo(7, 5);
  });

  it("FM: 6 × 7 = 42", async () => {
    // FM = 0x670D
    const s = await fpOp(6, 7, 0x670d);
    expect(decodeIbm(s.R[0], s.R[1])).toBeCloseTo(42, 5);
  });

  it("FD: 100 / 4 = 25", async () => {
    // FD = 0x6705
    const s = await fpOp(100, 4, 0x6705);
    expect(decodeIbm(s.R[0], s.R[1])).toBeCloseTo(25, 5);
  });

  it("FD: 0 除算 → V=1", async () => {
    const s = await fpOp(1, 0, 0x6705);
    expect(s.STR & STR_OVF).toBe(STR_OVF);
  });

  it("FS: 同値減算 → 0", async () => {
    const s = await fpOp(123.456, 123.456, 0x6f05);
    expect(s.R[0]).toBe(0);
    expect(s.R[1]).toBe(0);
  });

  it("FA: 分数 1/3 + 1/3 + 1/3 ≈ 1", async () => {
    const [h, l] = ibmHex(1 / 3);
    const words = new Array(0xa0).fill(0);
    words[0x50] = h;
    words[0x51] = l;
    // DR0 = 1/3
    words[0] = 0x7807;
    words[1] = h;
    words[2] = 0x7907;
    words[3] = l;
    words[4] = 0x7a07;
    words[5] = 0x0050;
    words[6] = 0x6f0d; // FA
    words[7] = 0x6f0d; // FA
    words[8] = 0x2000;
    const s = await runHalt(words);
    expect(decodeIbm(s.R[0], s.R[1])).toBeCloseTo(1, 4);
  });
});
