/**
 * コードテスト設定 JSON の読み込みとハーネス起動
 * 根拠: .cursor/rules/emulater_code_test.mdc §7
 */

import fs from "node:fs";
import path from "node:path";
import { Mn1613CodeTest } from "./mn1613_harness";
import { parseJsonInt, parseJsonNumber } from "./io_mock";
import type { CodeTestIoMockEntry, CodeTestSettings, Mn1613CodeTestOptions } from "./types";

/**
 * 値がプレーンオブジェクトか。
 * @param v 任意
 * @returns オブジェクトなら true
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * ioMock 1 エントリを検証して返す。
 * @param raw JSON 値
 * @param index 配列添字（エラー用）
 * @returns エントリ
 * @throws 形式不正
 */
function parseIoMockEntry(raw: unknown, index: number): CodeTestIoMockEntry {
  if (!isRecord(raw)) {
    throw new Error(`ioMock[${index}]: must be an object`);
  }
  const type = raw.type;
  if (type === "handshake") {
    const entry: Extract<CodeTestIoMockEntry, { type: "handshake" }> = {
      type: "handshake",
    };
    if (raw.timeoutMs !== undefined) {
      if (typeof raw.timeoutMs !== "number" && typeof raw.timeoutMs !== "string") {
        throw new Error(`ioMock[${index}].timeoutMs: must be number or string`);
      }
      entry.timeoutMs = parseJsonInt(
        raw.timeoutMs,
        `ioMock[${index}].timeoutMs`,
      );
    }
    if (raw.syncIrq2 !== undefined) {
      if (typeof raw.syncIrq2 !== "boolean") {
        throw new Error(`ioMock[${index}].syncIrq2: must be boolean`);
      }
      entry.syncIrq2 = raw.syncIrq2;
    }
    if (raw.start !== undefined) {
      if (typeof raw.start !== "boolean") {
        throw new Error(`ioMock[${index}].start: must be boolean`);
      }
      entry.start = raw.start;
    }
    return entry;
  }
  if (type !== undefined && type !== "port") {
    throw new Error(`ioMock[${index}]: unknown type '${String(type)}'`);
  }
  if (raw.port === undefined) {
    throw new Error(`ioMock[${index}]: port mock requires 'port'`);
  }
  if (typeof raw.port !== "number" && typeof raw.port !== "string") {
    throw new Error(`ioMock[${index}].port: must be number or string`);
  }
  const entry: Exclude<CodeTestIoMockEntry, { type: "handshake" }> = {
    type: "port",
    port: raw.port,
  };
  if (raw.read !== undefined) {
    if (Array.isArray(raw.read)) {
      entry.read = raw.read.map((v, i) => {
        if (typeof v !== "number" && typeof v !== "string") {
          throw new Error(`ioMock[${index}].read[${i}]: must be number or string`);
        }
        return v;
      });
    } else if (typeof raw.read === "number" || typeof raw.read === "string") {
      entry.read = raw.read;
    } else {
      throw new Error(`ioMock[${index}].read: must be number, string, or array`);
    }
  }
  return entry;
}

/**
 * 未知の JSON を CodeTestSettings に正規化する。
 * @param raw JSON.parse 結果
 * @returns 設定
 * @throws 形式不正
 */
export function parseCodeTestSettings(raw: unknown): CodeTestSettings {
  if (!isRecord(raw)) {
    throw new Error("code test settings: root must be an object");
  }
  const out: CodeTestSettings = {};
  /**
   * 任意の文字列フィールドをコピーする。
   * @param key キー
   */
  const copyStr = (key: "hexFile" | "cdbFile" | "hexText" | "cdbText"): void => {
    if (raw[key] === undefined) return;
    if (typeof raw[key] !== "string") {
      throw new Error(`settings.${key}: must be string`);
    }
    out[key] = raw[key];
  };
  copyStr("hexFile");
  copyStr("cdbFile");
  copyStr("hexText");
  copyStr("cdbText");
  /**
   * 任意の数値フィールドをコピーする。
   * @param key キー
   */
  const copyNum = (
    key: "stackInit" | "returnStubWordAddr" | "maxCycles" | "memoryBytes",
  ): void => {
    if (raw[key] === undefined) return;
    if (typeof raw[key] !== "number" && typeof raw[key] !== "string") {
      throw new Error(`settings.${key}: must be number or string`);
    }
    out[key] = raw[key];
  };
  copyNum("stackInit");
  copyNum("returnStubWordAddr");
  copyNum("maxCycles");
  copyNum("memoryBytes");
  if (raw.zeroPage !== undefined) {
    if (!isRecord(raw.zeroPage)) {
      throw new Error("settings.zeroPage: must be an object");
    }
    const zp: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(raw.zeroPage)) {
      if (typeof v !== "number" && typeof v !== "string") {
        throw new Error(`settings.zeroPage.${k}: must be number or string`);
      }
      zp[k] = v;
    }
    out.zeroPage = zp;
  }
  if (raw.ioMock !== undefined) {
    if (!Array.isArray(raw.ioMock)) {
      throw new Error("settings.ioMock: must be an array");
    }
    out.ioMock = raw.ioMock.map((e, i) => parseIoMockEntry(e, i));
  }
  return out;
}

/**
 * 設定 JSON ファイルを読む。
 * @param jsonPath JSON パス
 * @returns 設定と、相対パス解決用のディレクトリ
 */
export function loadCodeTestSettingsFile(jsonPath: string): {
  settings: CodeTestSettings;
  baseDir: string;
} {
  const abs = path.resolve(jsonPath);
  const text = fs.readFileSync(abs, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`code test settings '${abs}': invalid JSON (${msg})`);
  }
  return { settings: parseCodeTestSettings(raw), baseDir: path.dirname(abs) };
}

/**
 * 設定のファイルパスを baseDir 基準で解決する。
 * @param p パス
 * @param baseDir 基準ディレクトリ
 * @returns 絶対パス
 */
function resolveMaybe(p: string, baseDir: string): string {
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

/**
 * 設定 JSON（オブジェクトまたはファイルパス）からハーネスを起こす。
 * `ioMock` があれば RD/WT モックをキックする。
 * @param source 設定オブジェクト、または JSON ファイルパス
 * @param options.baseDir hexFile / cdbFile の相対基準（ファイル読み込み時は JSON のディレクトリ）
 * @returns 初期化済みハーネス（HEX/CDB があればロード済み）
 */
export function createMn1613CodeTestFromSettings(
  source: CodeTestSettings | string,
  options: { baseDir?: string } = {},
): Mn1613CodeTest {
  let settings: CodeTestSettings;
  let baseDir = options.baseDir ?? process.cwd();
  if (typeof source === "string") {
    const loaded = loadCodeTestSettingsFile(source);
    settings = loaded.settings;
    baseDir = options.baseDir ?? loaded.baseDir;
  } else {
    settings = source;
  }

  const opts: Mn1613CodeTestOptions = {};
  if (settings.stackInit !== undefined) {
    opts.stackInit = parseJsonNumber(settings.stackInit, "settings.stackInit");
  }
  if (settings.returnStubWordAddr !== undefined) {
    opts.returnStubWordAddr = parseJsonNumber(
      settings.returnStubWordAddr,
      "settings.returnStubWordAddr",
    );
  }
  if (settings.maxCycles !== undefined) {
    opts.maxCycles = parseJsonInt(settings.maxCycles, "settings.maxCycles");
  }
  if (settings.memoryBytes !== undefined) {
    opts.memoryBytes = parseJsonInt(
      settings.memoryBytes,
      "settings.memoryBytes",
    );
  }
  if (settings.ioMock && settings.ioMock.length > 0) {
    opts.ioMock = settings.ioMock;
  }

  const t = new Mn1613CodeTest(opts);

  const hexText =
    settings.hexText ??
    (settings.hexFile
      ? fs.readFileSync(resolveMaybe(settings.hexFile, baseDir), "utf8")
      : undefined);
  if (hexText !== undefined) {
    t.loadIntelHex(hexText);
  }
  const cdbText =
    settings.cdbText ??
    (settings.cdbFile
      ? fs.readFileSync(resolveMaybe(settings.cdbFile, baseDir), "utf8")
      : undefined);
  if (cdbText !== undefined) {
    t.loadCdb(cdbText);
  }
  if (settings.zeroPage) {
    const map: Record<number, number> = {};
    for (const [k, v] of Object.entries(settings.zeroPage)) {
      const addr = parseJsonNumber(k, `settings.zeroPage key ${k}`);
      map[addr] = parseJsonNumber(v, `settings.zeroPage.${k}`);
    }
    t.writeZeroPageWords(map);
  }
  return t;
}
