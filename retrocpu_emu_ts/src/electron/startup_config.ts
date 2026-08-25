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
  emulatePort: number;
  /** ブートモニタ IHX。設定エリアには書かない */
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
  const settings = defaultSettingsForCpu(CPU_TYPE.MN1613);
  return {
    settings,
    emulatePort: settings.emulatePort,
  };
}

/**
 * 起動 JSON（unknown）を IO 設定へ正規化する。
 * 文字列値（"0x..." / "123"）も受け付ける。
 */
export function parseStartupConfigObject(raw: unknown): StartupConfig {
  const base = defaultSettingsForCpu(CPU_TYPE.MN1613);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { settings: base, emulatePort: base.emulatePort };
  }

  const src = raw as Record<string, unknown>;
  const cpuParsed = parseNumberish(src.cpu);
  const cpuType = isCpuType(cpuParsed) ? cpuParsed : base.cpuType;

  const cpuDefaults = defaultSettingsForCpu(cpuType);
  const settings: IoBoardSettings = {
    ...cpuDefaults,
    clockDiv: clampTo(parseNumberish(src.clock), 0, 3, cpuDefaults.clockDiv),
    cpuType,
    cpuTypeReset: 0,
    addrStep: parseAddrStep(
      parseNumberish(src.address_addcount),
      cpuDefaults.addrStep,
    ),
    resetVector: toU32(
      parseNumberish(src.reset_vector),
      cpuDefaults.resetVector,
    ),
    sevenSegAddrDigits: clampTo(
      parseNumberish(
        src.sevenseg_adddress_digit ??
          src.sevenseg_address_digit ??
          src.sevenseg_addr_digit,
      ),
      0,
      255,
      cpuDefaults.sevenSegAddrDigits,
    ),
    sevenSegDataDigits: clampTo(
      parseNumberish(src.sevenseg_data_digit),
      0,
      255,
      cpuDefaults.sevenSegDataDigits,
    ),
    emulatePort: clampTo(
      parseNumberish(src.emulate_port),
      1,
      65535,
      cpuDefaults.emulatePort,
    ),
    stepDelay: clampTo(
      parseNumberish(src.step_delay),
      0,
      255,
      cpuDefaults.stepDelay,
    ),
  };

  const bootMonitorHex = parseNonEmptyString(src.boot);

  return {
    settings,
    emulatePort: settings.emulatePort,
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
 * jsonc から読んだ値を IO ボード設定エリアへ書く。
 * `boot` は IHX パス専用なので設定エリアには含めない。
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

function toU32(value: number | undefined, fallback: number): number {
  if (value == null) return fallback >>> 0;
  return value >>> 0;
}

/**
 * アドレス増加数を 1 または 2 にする。未指定・不正は CPU 既定。
 * @param value jsonc の address_addcount
 * @param fallback CPU 種類の既定増加数
 */
function parseAddrStep(value: number | undefined, fallback: number): number {
  if (value === ADDR_STEP_1 || value === ADDR_STEP_2) return value;
  return fallback === ADDR_STEP_2 ? ADDR_STEP_2 : ADDR_STEP_1;
}

function isCpuType(value: number | undefined): value is number {
  return (
    value === CPU_TYPE.MN1613 ||
    value === CPU_TYPE.TMS9995 ||
    value === CPU_TYPE.Z8002 ||
    value === CPU_TYPE.MC68332
  );
}
