import type { CpuArchitecture } from "./types";
import {
  mn1613Architecture,
  SHARED_ASM_EXTENSIONS,
} from "./mn1613/arch";
import { scanSourceCpuId } from "./parseCpuDirective";
import { tms9995Architecture } from "./tms9995/arch";

const ARCHITECTURES: readonly CpuArchitecture[] = [
  mn1613Architecture,
  tms9995Architecture,
];

/** ワークスペース既定 CPU（ステータスバー / 設定と同期） */
let preferredCpuId = "mn1613";

/**
 * 登録済みアーキテクチャ一覧を返す。
 * @return CPU 定義配列
 */
export function listArchitectures(): readonly CpuArchitecture[] {
  return ARCHITECTURES;
}

/**
 * 選択可能な CPU（ステータスバー用）。
 * @return 選択候補
 */
export function listSelectableCpus(): readonly CpuArchitecture[] {
  return ARCHITECTURES;
}

/**
 * ID からアーキテクチャを取得する。
 * @param id - アーキテクチャ ID
 * @return 見つかれば定義、なければ undefined
 */
export function getArchitecture(id: string): CpuArchitecture | undefined {
  return ARCHITECTURES.find((a) => a.id === id);
}

/**
 * ステータスバー / 設定で選ばれた既定 CPU ID。
 * @return CPU ID
 */
export function getPreferredCpuId(): string {
  return preferredCpuId;
}

/**
 * 既定 CPU を設定する（設定変更・ステータスバー選択時）。
 * @param id - CPU ID
 * @return 解決できたアーキテクチャ（不明なら MN1613）
 */
export function setPreferredCpuId(id: string): CpuArchitecture {
  const arch = getArchitecture(id) ?? mn1613Architecture;
  preferredCpuId = arch.id;
  return arch;
}

/**
 * 現在の既定アーキテクチャ。
 * @return CPU 定義
 */
export function getPreferredArchitecture(): CpuArchitecture {
  return getArchitecture(preferredCpuId) ?? mn1613Architecture;
}

/**
 * ファイル名とソースからアーキテクチャを推定する。
 * - 先頭の有効な `.cpu`（asm-rules.mdc）があればそれを最優先
 * - 無ければ `.mn1613` / `.mn1610` / `.tms9995` 拡張子（`.mn1610` は MN1613 として解釈）
 * - `.asm` / `.s` / `.inc` / `.h` はステータスバー選択（既定 CPU）
 * @param fileName - ファイル名またはパス
 * @param sourceText - ソース全文（省略時は拡張子／既定のみ）
 * @return 推定アーキテクチャ
 */
export function detectArchitecture(
  fileName: string,
  sourceText?: string,
): CpuArchitecture {
  if (sourceText !== undefined) {
    const fromCpu = scanSourceCpuId(sourceText);
    if (fromCpu) {
      const arch = getArchitecture(fromCpu);
      if (arch) return arch;
    }
  }

  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  const ext = (dot >= 0 ? base.slice(dot + 1) : "").toLowerCase();

  if (ext === "mn1610" || ext === "mn1613") return mn1613Architecture;
  if (ext === "tms9995") return tms9995Architecture;

  if ((SHARED_ASM_EXTENSIONS as readonly string[]).includes(ext)) {
    return getPreferredArchitecture();
  }

  for (const arch of ARCHITECTURES) {
    if (arch.extensions.includes(ext)) return arch;
  }
  return getPreferredArchitecture();
}
