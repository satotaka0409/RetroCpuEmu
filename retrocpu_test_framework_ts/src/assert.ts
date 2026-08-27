/**
 * 独自テストランナー用の簡易アサート
 * 根拠: test_framework.mdc
 */

/**
 * 値が等しくなければ例外を投げる。
 * @param actual 実際
 * @param expected 期待
 * @param label メッセージ
 */
export function assertEqual(
  actual: unknown,
  expected: unknown,
  label = "assertEqual",
): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${fmt(expected)}, got ${fmt(actual)}`);
  }
}

/**
 * 深い等価比較。
 * @param actual 実際
 * @param expected 期待
 * @param label メッセージ
 */
export function assertDeepEqual(
  actual: unknown,
  expected: unknown,
  label = "assertDeepEqual",
): void {
  const diff = deepDiff(actual, expected, "");
  if (diff) {
    throw new Error(`${label}: ${diff}`);
  }
}

/**
 * expected のキーだけ actual に含まれるか（部分一致）。
 * @param actual 実際のオブジェクト
 * @param expected 期待する部分
 * @param label メッセージ
 */
export function assertMatchObject(
  actual: unknown,
  expected: Record<string, unknown>,
  label = "assertMatchObject",
): void {
  if (actual === null || typeof actual !== "object") {
    throw new Error(`${label}: actual is not an object (${fmt(actual)})`);
  }
  const rec = actual as Record<string, unknown>;
  for (const [k, exp] of Object.entries(expected)) {
    if (exp !== null && typeof exp === "object" && !Array.isArray(exp)) {
      assertMatchObject(rec[k], exp as Record<string, unknown>, `${label}.${k}`);
    } else if (Array.isArray(exp)) {
      assertDeepEqual(rec[k], exp, `${label}.${k}`);
    } else if (!Object.is(rec[k], exp)) {
      throw new Error(
        `${label}.${k}: expected ${fmt(exp)}, got ${fmt(rec[k])}`,
      );
    }
  }
}

/**
 * 文字列／配列が部分を含むか。
 * @param haystack 対象
 * @param needle 部分
 * @param label メッセージ
 */
export function assertContain(
  haystack: string | unknown[],
  needle: unknown,
  label = "assertContain",
): void {
  if (typeof haystack === "string") {
    if (!haystack.includes(String(needle))) {
      throw new Error(`${label}: '${haystack}' does not contain '${needle}'`);
    }
    return;
  }
  if (!haystack.includes(needle)) {
    throw new Error(`${label}: array does not contain ${fmt(needle)}`);
  }
}

/**
 * 関数が例外を投げるか。
 * @param fn 実行する関数
 * @param pattern メッセージ正規表現（省略可）
 * @param label メッセージ
 */
export function assertThrow(
  fn: () => unknown,
  pattern?: RegExp,
  label = "assertThrow",
): void {
  try {
    fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (pattern && !pattern.test(msg)) {
      throw new Error(`${label}: threw '${msg}', expected ${pattern}`);
    }
    return;
  }
  throw new Error(`${label}: expected throw`);
}

/**
 * 値を短く文字列化する。
 * @param v 任意値
 * @returns 表示用
 */
function fmt(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? `0x${(v >>> 0).toString(16).toUpperCase()} (${v})`
      : String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * 深い差分があれば説明文を返す。
 * @param actual 実際
 * @param expected 期待
 * @param path パス
 * @returns 差分説明、一致なら null
 */
function deepDiff(actual: unknown, expected: unknown, path: string): string | null {
  if (Object.is(actual, expected)) return null;
  if (typeof actual !== typeof expected) {
    return `${path || "."}: expected ${fmt(expected)}, got ${fmt(actual)}`;
  }
  if (actual === null || expected === null || typeof expected !== "object") {
    return `${path || "."}: expected ${fmt(expected)}, got ${fmt(actual)}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return `${path || "."}: expected ${fmt(expected)}, got ${fmt(actual)}`;
    }
    for (let i = 0; i < expected.length; i += 1) {
      const d = deepDiff(actual[i], expected[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const a = actual as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
  for (const k of keys) {
    const d = deepDiff(a[k], e[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}
