/**
 * テストケース名を CPU ログへ START/END で囲む印
 * 根拠: asm_test_framework.mdc §テスト専用 CPU ログ出力
 * unit.ts から呼ぶ（emu 非依存）。
 */

/** START / END */
export type CpuLogTestPhase = "START" | "END";

type CpuLogMarker = {
  appendTestMark(name: string, phase: CpuLogTestPhase): void;
};

let active: CpuLogMarker | null = null;
let pendingName: string | null = null;

/**
 * CpuExecutionLog の生成・破棄時に登録する。
 * @param marker アクティブなログ。無しは null
 */
export function setActiveCpuLogMarker(marker: CpuLogMarker | null): void {
  active = marker;
}

/** ファイル切り替えなどで印を捨てる */
export function clearCpuLogTestMark(): void {
  active = null;
  pendingName = null;
}

/**
 * ケース開始。ログが既にあれば即 START、無ければ構築待ち。
 * @param name `test()` のタイトル
 */
export function beginCpuLogTest(name: string): void {
  pendingName = name;
  active?.appendTestMark(name, "START");
}

/**
 * ケース終了。失敗時も呼ぶ。
 * @param name `test()` のタイトル
 */
export function endCpuLogTest(name: string): void {
  active?.appendTestMark(name, "END");
  pendingName = null;
}

/**
 * ログ構築直後に、未出力のケース名があれば返す。
 * @returns 保留中のタイトル。無ければ null
 */
export function takePendingCpuLogTestName(): string | null {
  const n = pendingName;
  pendingName = null;
  return n;
}
