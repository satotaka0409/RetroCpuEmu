/**
 * TMS9995 呼び出し規約ユーティリティのユニットテスト。
 */

import {
  planTms9995Call,
  validateTms9995ArgRegisters,
} from "../src/tms9995/calling_convention.js";
import { expect, test } from "../src/unit.js";

test("引数 8 個までは R2..R9 に割り当てる", () => {
  const plan = planTms9995Call({
    args: [1, 2, 3, 4, 5, 6, 7, 8],
    stackInit: 0x8400,
    returnAddr: 0x1234,
  });

  expect(plan.spBeforePush).toBe(0x8400);
  expect(plan.spAfterPush).toBe(0x8400);
  expect(plan.registers[2]).toBe(1);
  expect(plan.registers[3]).toBe(2);
  expect(plan.registers[4]).toBe(3);
  expect(plan.registers[5]).toBe(4);
  expect(plan.registers[6]).toBe(5);
  expect(plan.registers[7]).toBe(6);
  expect(plan.registers[8]).toBe(7);
  expect(plan.registers[9]).toBe(8);
  expect(plan.registers[10]).toBe(0x8400);
  expect(plan.registers[11]).toBe(0x1234);
  expect(plan.stackWords.length).toBe(0);
});

test("9 個目以降は後ろから push してスタックへ置く", () => {
  const plan = planTms9995Call({
    args: [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19],
    stackInit: 0x8400,
  });

  expect(plan.spAfterPush).toBe(0x83fc);
  expect(plan.stackWords).toEqual([
    { byteAddr: 0x83fe, value: 0x19, argIndex: 9 },
    { byteAddr: 0x83fc, value: 0x18, argIndex: 8 },
  ]);
  expect(plan.argLocations).toEqual([
    { kind: "register", argIndex: 0, reg: 2, value: 0x10 },
    { kind: "register", argIndex: 1, reg: 3, value: 0x11 },
    { kind: "register", argIndex: 2, reg: 4, value: 0x12 },
    { kind: "register", argIndex: 3, reg: 5, value: 0x13 },
    { kind: "register", argIndex: 4, reg: 6, value: 0x14 },
    { kind: "register", argIndex: 5, reg: 7, value: 0x15 },
    { kind: "register", argIndex: 6, reg: 8, value: 0x16 },
    { kind: "register", argIndex: 7, reg: 9, value: 0x17 },
    { kind: "stack", argIndex: 8, byteAddr: 0x83fc, value: 0x18 },
    { kind: "stack", argIndex: 9, byteAddr: 0x83fe, value: 0x19 },
  ]);
});

test("規約上の禁止レジスタを引数に使うとエラー", () => {
  expect(() =>
    planTms9995Call({
      args: [1, 2],
      argRegisters: [0, 2],
    }),
  ).toThrow(/forbidden/);
});

test("偶数でない stackInit は拒否する", () => {
  expect(() =>
    planTms9995Call({
      args: [1],
      stackInit: 0x8301,
    }),
  ).toThrow(/even byte address/);
});

test("validate は範囲外・重複・禁止を個別に返す", () => {
  const d = validateTms9995ArgRegisters([2, 2, 11, 99]);
  expect(d).toEqual({
    forbiddenArgRegisters: [11],
    duplicatedArgRegisters: [2],
    outOfRangeArgRegisters: [99],
  });
});

test("既定 stackInit はモニター memmap の 0xFE00", () => {
  const plan = planTms9995Call({
    args: [1],
  });
  expect(plan.spBeforePush).toBe(0xfe00);
  expect(plan.registers[10]).toBe(0xfe00);
});

test("allowSpecialPurposeRegisters なら R1 を第1引数にできる（非推奨経路）", () => {
  const plan = planTms9995Call({
    args: [0xaa, 0xbb, 0xcc],
    argRegisters: [1, 2, 3],
    allowSpecialPurposeRegisters: true,
  });
  expect(plan.registers[1]).toBe(0xaa);
  expect(plan.registers[2]).toBe(0xbb);
  expect(plan.registers[3]).toBe(0xcc);
});

test("既定は第1引数が R2（asm_rules）", () => {
  const plan = planTms9995Call({
    args: [0x11, 0x22, 0x33],
  });
  expect(plan.registers[2]).toBe(0x11);
  expect(plan.registers[3]).toBe(0x22);
  expect(plan.registers[4]).toBe(0x33);
});
