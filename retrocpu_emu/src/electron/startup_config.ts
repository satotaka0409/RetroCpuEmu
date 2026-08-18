import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import {
  ADDR_STEP_1,
  ADDR_STEP_2,
  CPU_TYPE,
  createFileSettingAreaStorage,
  defaultSettingsForCpu,
  saveSettingArea,
  type IoBoardSettings,
} from "../ioboard/setting_area";

export type StartupConfig = {
  settings: IoBoardSettings;
  emulatePort?: number;
  bootMonitorHex?: string;
};

export type StartupConfigLoadResult = StartupConfig & {
  source: "default" | "json";
  configPath?: string;
};

/**
 * 起動引数が無い場合の既定設定（MN1613）。
 */
export function createDefaultStartupConfig(): StartupConfig {
  return {
    settings: defaultSettingsForCpu(CPU_TYPE.MN1613),
  };
}

/**
 * 起動 JSON（unknown）を IO 設定へ正規化する。
 * 文字列値（"0x..." / "123"）も受け付ける。
 */
export function parseStartupConfigObject(raw: unknown): StartupConfig {
  const base = defaultSettingsForCpu(CPU_TYPE.MN1613);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { settings: base };
  }

  const src = raw as Record<string, unknown>;
  const cpuParsed = parseNumberish(src.cpu);
  const cpuType = isCpuType(cpuParsed) ? cpuParsed : base.cpuType;

  const settings: IoBoardSettings = {
    ...defaultSettingsForCpu(cpuType),
    clockDiv: clampTo(parseNumberish(src.clock), 0, 3, base.clockDiv),
    cpuType,
    cpuTypeReset: 0,
    addrStep:
      parseNumberish(src.address_addcount) === ADDR_STEP_2
        ? ADDR_STEP_2
        : ADDR_STEP_1,
    resetVector: toU32(parseNumberish(src.reset_vector), base.resetVector),
    sevenSegAddrDigits: clampTo(
      parseNumberish(
        src.sevenseg_adddress_digit ??
          src.sevenseg_address_digit ??
          src.sevenseg_addr_digit,
      ),
      0,
      255,
      defaultSettingsForCpu(cpuType).sevenSegAddrDigits,
    ),
    sevenSegDataDigits: clampTo(
      parseNumberish(src.sevenseg_data_digit),
      0,
      255,
      defaultSettingsForCpu(cpuType).sevenSegDataDigits,
    ),
  };

  const emulatePort = clampOptional(parseNumberish(src.emulate_port), 1, 65535);
  const bootMonitorHex = parseNonEmptyString(src.boot);

  return {
    settings,
    emulatePort,
    bootMonitorHex,
  };
}

/**
 * argv から JSON ファイルを探して読み込む。
 * 見つからない場合は MN1613 既定設定を返す。
 */
export async function loadStartupConfigFromArgv(
  argv: string[],
  cwd = process.cwd(),
): Promise<StartupConfigLoadResult> {
  const configPath = findConfigArg(argv, cwd);
  if (!configPath) {
    return {
      ...createDefaultStartupConfig(),
      source: "default",
    };
  }

  const text = await fs.readFile(configPath, "utf8");
  const parsed = parseJsonc(text) as unknown;
  const loaded = parseStartupConfigObject(parsed);
  return {
    ...loaded,
    bootMonitorHex: resolveBootPath(
      loaded.bootMonitorHex,
      path.dirname(configPath),
    ),
    source: "json",
    configPath,
  };
}

/**
 * IO 設定エリアへ起動設定を書き込む。
 */
export async function saveStartupConfigToSettingArea(
  settingAreaPath: string,
  config: StartupConfig,
): Promise<void> {
  const storage = createFileSettingAreaStorage(settingAreaPath);
  await saveSettingArea(storage, config.settings);
}

function findConfigArg(argv: string[], cwd: string): string | undefined {
  for (const arg of argv.slice(1)) {
    if (!arg) continue;
    if (arg.startsWith("-")) continue;
    if (!/\.(json|jsonc)$/i.test(arg)) continue;
    return path.resolve(cwd, arg);
  }
  return undefined;
}

function resolveBootPath(
  bootPath: string | undefined,
  baseDir: string,
): string | undefined {
  if (!bootPath) return undefined;
  return path.isAbsolute(bootPath)
    ? path.normalize(bootPath)
    : path.resolve(baseDir, bootPath);
}

function parseNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function parseNumberish(v: unknown): number | undefined {
  if (typeof v === "number") {
    return Number.isFinite(v) ? Math.trunc(v) : undefined;
  }
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (s.length === 0) return undefined;
  if (/^[+-]?0x[0-9a-f]+$/i.test(s)) {
    const n = Number.parseInt(s, 16);
    return Number.isFinite(n) ? n : undefined;
  }
  if (/^[+-]?0b[01]+$/i.test(s)) {
    const n = Number.parseInt(s.slice(2), 2);
    return Number.isFinite(n) ? n : undefined;
  }
  if (/^[+-]?\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clampTo(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value == null) return fallback;
  if (value < min) return fallback;
  if (value > max) return fallback;
  return value;
}

function clampOptional(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value == null) return undefined;
  if (value < min) return undefined;
  if (value > max) return undefined;
  return value;
}

function toU32(value: number | undefined, fallback: number): number {
  if (value == null) return fallback >>> 0;
  return value >>> 0;
}

function isCpuType(value: number | undefined): value is number {
  return (
    value === CPU_TYPE.MN1613 ||
    value === CPU_TYPE.TMS9995 ||
    value === CPU_TYPE.Z8002 ||
    value === CPU_TYPE.MC68332
  );
}
