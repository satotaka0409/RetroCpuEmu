/**
 * フレームワーク内部用の小さなユニットテスト API（Vitest は使わない）
 * 根拠: test_framework.mdc
 */

import {
  assertContain,
  assertDeepEqual,
  assertEqual,
  assertThrow,
} from "./assert.js";

type UnitFn = () => void | Promise<void>;

type UnitEntry = { name: string; fn: UnitFn };

type UnitGlobal = typeof globalThis & { __rtfUnitRegistry?: UnitEntry[] };

/**
 * レジストリは globalThis に置く（CLI と monitor テストで unit.ts が二重になっても共有する）。
 * @returns 共通レジストリ
 */
function unitRegistry(): UnitEntry[] {
  const g = globalThis as UnitGlobal;
  if (!g.__rtfUnitRegistry) {
    g.__rtfUnitRegistry = [];
  }
  return g.__rtfUnitRegistry;
}

/**
 * ユニットテストを登録する。
 * @param name ケース名
 * @param fn 本体
 */
export function test(name: string, fn: UnitFn): void {
  unitRegistry().push({ name, fn });
}

/**
 * 登録済みユニットテストを取り出し、レジストリを空にする。
 * @returns 登録分
 */
export function takeUnitTests(): UnitEntry[] {
  const registry = unitRegistry();
  const copy = [...registry];
  registry.length = 0;
  return copy;
}

/**
 * Jest 風の `expect(x).toBe(y)`。
 * @param actual 実際
 * @returns マッチャ
 */
export function expect(actual: unknown): {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(needle: unknown): void;
  not: { toContain(needle: unknown): void };
  toBeGreaterThanOrEqual(n: number): void;
  toBeDefined(): void;
  toBeTruthy(): void;
  toThrow(pattern?: RegExp): void;
} {
  return {
    /**
     * @param expected 期待（Object.is）
     */
    toBe(expected: unknown): void {
      assertEqual(actual, expected);
    },
    /**
     * @param expected 深い等価
     */
    toEqual(expected: unknown): void {
      assertDeepEqual(actual, expected);
    },
    /**
     * @param needle 部分
     */
    toContain(needle: unknown): void {
      if (typeof actual !== "string" && !Array.isArray(actual)) {
        throw new Error("toContain: actual must be string or array");
      }
      assertContain(actual, needle);
    },
    not: {
      /**
       * @param needle 含んではいけない部分
       */
      toContain(needle: unknown): void {
        if (typeof actual === "string") {
          if (actual.includes(String(needle))) {
            throw new Error(`expected not to contain ${String(needle)}`);
          }
          return;
        }
        if (Array.isArray(actual) && actual.includes(needle)) {
          throw new Error(`expected array not to contain ${String(needle)}`);
        }
      },
    },
    /**
     * @param n 下限
     */
    toBeGreaterThanOrEqual(n: number): void {
      if (typeof actual !== "number" || actual < n) {
        throw new Error(`expected >= ${n}, got ${String(actual)}`);
      }
    },
    /** 未定義でないこと */
    toBeDefined(): void {
      if (actual === undefined) {
        throw new Error("expected defined");
      }
    },
    /** truthy */
    toBeTruthy(): void {
      if (!actual) {
        throw new Error("expected truthy");
      }
    },
    /**
     * actual が関数のとき例外を期待する。
     * @param pattern メッセージ
     */
    toThrow(pattern?: RegExp): void {
      if (typeof actual !== "function") {
        throw new Error("toThrow: actual must be a function");
      }
      assertThrow(actual as () => unknown, pattern);
    },
  };
}
