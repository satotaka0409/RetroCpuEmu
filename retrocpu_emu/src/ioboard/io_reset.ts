/**
 * IO ボードのリセット動作（ioboard.mdc）
 *
 * F7 RST / 電源投入相当: HALT → ブートモニタ IHX を DMA 書き込み → CPU リセット。
 * RESET_VECTOR（IO:0）は既定 0x0108（`g_reset_vector` 表先頭。STR/IC は表+2/+3）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIntelHex } from "../code_test/intel_hex";
import { MEM_BYTES } from "../shared/shared_board";

/** 探索する IHX ファイル名（先に見つかった方を使う） */
export const BOOT_MONITOR_HEX_NAMES = [
  "boot_monitor.ihx",
  "mn1613_mon.ihx",
] as const;

/** DMA / HALT / RST を行うリンク面 */
export type IoResetLink = {
  /** true で CPU を HALT（DMA 前） */
  setHalt(halt: boolean): Promise<void>;
  /** DMA で CPU RAM へ書く（バイトアドレス） */
  writeBytes(byteAddr: number, data: Uint8Array): Promise<void>;
  /** RST パルス（IO:0 の表先頭をラッチ。CPU が mem[+2/+3] を STR/IC に載せて実行開始） */
  pulseReset(resetVectorWord?: number): Promise<void>;
};

/** IHX を DMA できる連続スライスにしたもの */
export type BootMonitorDmaSlice = {
  /** 書き込み開始バイトアドレス */
  byteAddr: number;
  /** minAddr〜maxAddr のバイト列 */
  data: Uint8Array;
  /** HEX 上の有効バイト数 */
  bytesWritten: number;
};

/** esbuild CJS 出力では __dirname が使える（vitest ESM では未定義） */
declare const __dirname: string | undefined;

/**
 * このモジュールのディレクトリ（esbuild CJS / vitest ESM 両対応）。
 * @returns 絶対パス
 */
function moduleDir(): string {
  try {
    const metaUrl = import.meta.url;
    if (typeof metaUrl === "string" && metaUrl.length > 0) {
      return path.dirname(fileURLToPath(metaUrl));
    }
  } catch {
    // CJS バンドルでは import.meta.url が空
  }
  if (typeof __dirname === "string" && __dirname.length > 0) {
    return __dirname;
  }
  return process.cwd();
}

/**
 * ブートモニタ IHX を探す候補ディレクトリ。
 * @returns 探索順の絶対パス
 */
function hexSearchDirs(): string[] {
  const dirs: string[] = [];
  /**
   * 重複しない絶対パスを候補へ足す。
   * @param p 相対または絶対パス
   */
  const add = (p: string): void => {
    const abs = path.resolve(p);
    if (!dirs.includes(abs)) dirs.push(abs);
  };
  add(path.join(moduleDir(), "../assets"));
  add(path.join(moduleDir(), "../../assets"));
  add(path.join(process.cwd(), "assets"));
  add(path.join(process.cwd(), "dist/assets"));
  add(path.join(process.cwd(), "retrocpu_boot_monitor/build/hex/mn1613"));
  add(path.join(process.cwd(), "../retrocpu_boot_monitor/build/hex/mn1613"));
  add(
    path.join(process.cwd(), "../../retrocpu_boot_monitor/build/hex/mn1613"),
  );
  add(
    path.join(moduleDir(), "../../../retrocpu_boot_monitor/build/hex/mn1613"),
  );
  add(
    path.join(moduleDir(), "../../../../retrocpu_boot_monitor/build/hex/mn1613"),
  );
  return dirs;
}

/**
 * ブートモニタ IHX のパスを決める。
 * 優先: 明示パス / `RETROCPU_BOOT_MONITOR_HEX` → 探索ディレクトリ内の
 * `boot_monitor.ihx` / `mn1613_mon.ihx`。
 * @param explicit 呼び出し側が渡す絶対／相対パス（任意）
 * @returns 存在するファイルの絶対パス
 * @throws 見つからない場合
 */
export function resolveBootMonitorHexPath(explicit?: string): string {
  const env = process.env.RETROCPU_BOOT_MONITOR_HEX?.trim();
  const first = (explicit?.trim() || env || "").trim();
  if (first) {
    const abs = path.resolve(first);
    if (!fs.existsSync(abs)) {
      throw new Error(`ブートモニタ IHX が無い: ${abs}`);
    }
    return abs;
  }
  for (const dir of hexSearchDirs()) {
    for (const name of BOOT_MONITOR_HEX_NAMES) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error(
    "ブートモニタ IHX が見つからない（boot_monitor.ihx / mn1613_mon.ihx）。" +
      " retrocpu_boot_monitor を make ihx するか RETROCPU_BOOT_MONITOR_HEX を指定する",
  );
}

/**
 * IHX に対応する CDB パス（同じ stem）。無ければ探索ディレクトリの `mn1613_mon.cdb`。
 * @param hexPath 対応 IHX。省略時は探索のみ
 * @returns 存在する `.cdb` の絶対パス
 * @throws CDB が無い場合
 */
export function resolveBootMonitorCdbPath(hexPath?: string): string {
  if (hexPath) {
    const beside = hexPath.replace(/\.ihx$/i, ".cdb");
    if (fs.existsSync(beside)) return beside;
  }
  for (const dir of hexSearchDirs()) {
    for (const name of ["mn1613_mon.cdb", "boot_monitor.cdb"] as const) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error(
    "ブートモニタ CDB が見つからない（mn1613_mon.cdb）。retrocpu_boot_monitor を make ihx する",
  );
}

/**
 * IHX と CDB が揃っているモニタ成果物を選ぶ（テスト用。dist の ihx のみは除外）。
 * @returns hex / cdb の絶対パス
 * @throws 揃った組が無い場合
 */
export function resolveBootMonitorHexCdbPair(): { hex: string; cdb: string } {
  for (const dir of hexSearchDirs()) {
    for (const name of BOOT_MONITOR_HEX_NAMES) {
      const hex = path.join(dir, name);
      const cdb = hex.replace(/\.ihx$/i, ".cdb");
      if (fs.existsSync(hex) && fs.existsSync(cdb)) {
        return { hex, cdb };
      }
    }
  }
  throw new Error(
    "ブートモニタ IHX+CDB の組が見つからない。retrocpu_boot_monitor を make ihx する",
  );
}

/**
 * Intel HEX テキストを DMA 用の連続バイト列にする。
 * @param hexText Intel HEX 全文
 * @returns スライス。データが無ければ null
 */
export function expandBootMonitorHex(
  hexText: string,
): BootMonitorDmaSlice | null {
  const buf = new Uint8Array(MEM_BYTES);
  const result = loadIntelHex(hexText, buf);
  if (result.bytesWritten <= 0 || !Number.isFinite(result.minAddr)) {
    return null;
  }
  return {
    byteAddr: result.minAddr,
    data: buf.subarray(result.minAddr, result.maxAddr + 1),
    bytesWritten: result.bytesWritten,
  };
}

/**
 * IHX ファイルを読んで DMA スライスにする。
 * @param hexPath IHX の絶対パス
 * @returns スライス
 * @throws ファイルが無い、またはデータレコードが無い場合
 */
export function readBootMonitorDmaSlice(hexPath: string): BootMonitorDmaSlice {
  const text = fs.readFileSync(hexPath, "utf8");
  const slice = expandBootMonitorHex(text);
  if (!slice) {
    throw new Error(`ブートモニタ IHX に書き込むデータが無い: ${hexPath}`);
  }
  return slice;
}

/**
 * IO ボードリセット本体（F7 RST / 電源投入）: HALT → ブートモニタ DMA → RST。
 * RST 側が HLT を落としてからパルスする（残したままだと即 halted）。
 * @param link CPU ボードへの DMA / HALT / RST
 * @param hexPath ブートモニタ IHX
 * @returns 書き込んだバイト数と使ったパス
 */
export async function performIoBoardReset(
  link: IoResetLink,
  hexPath: string,
  resetVectorWord?: number,
): Promise<{ bytesWritten: number; hexPath: string }> {
  const slice = readBootMonitorDmaSlice(hexPath);
  await link.setHalt(true);
  await link.writeBytes(slice.byteAddr, slice.data);
  await link.pulseReset(resetVectorWord);
  return { bytesWritten: slice.bytesWritten, hexPath };
}
