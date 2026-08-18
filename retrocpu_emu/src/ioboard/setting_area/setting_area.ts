/**
 * IOボード設定エリア（NOR フラッシュ後半 256 バイト）
 * 根拠: ioboard.mdc 「IOボード設定エリア」
 */

import fs from "node:fs/promises";
import path from "node:path";

export const SETTING_AREA_SIZE = 256;
export const SETTING_MARK = 0xaa55;

export const OFFSETS = {
  MARK_HI: 0x00,
  MARK_LO: 0x01,
  CLOCK_DIV: 0x02,
  CPU_TYPE: 0x03,
  CPU_TYPE_RESET: 0x04,
  ADDR_STEP: 0x05,
  RESET_VECTOR_0: 0x06,
  RESET_VECTOR_1: 0x07,
  RESET_VECTOR_2: 0x08,
  RESET_VECTOR_3: 0x09,
  SEVEN_SEG_ADDR_DIGITS: 0x0a,
  SEVEN_SEG_DATA_DIGITS: 0x0b,
  EMULATE_PORT_HI: 0x0c,
  EMULATE_PORT_LO: 0x0d,
} as const;

/** エミュレータ受付ポート既定値（ioboard.mdc 0C–0D。0x7148 = 29000） */
export const DEFAULT_EMULATE_PORT = 0x7148;

/** アドレス増加数: 1 ずつ */
export const ADDR_STEP_1 = 1;
/** アドレス増加数: 2 ずつ（奇数入力はアクション時に -1 して偶数へ） */
export const ADDR_STEP_2 = 2;

export const CPU_TYPE = {
  MN1613: 1,
  TMS9995: 2,
  Z8002: 3,
  MC68332: 4,
} as const;

export type IoBoardSettings = {
  clockDiv: number;
  cpuType: number;
  cpuTypeReset: number;
  /** アドレス増加数（1 または 2） */
  addrStep: number;
  resetVector: number;
  sevenSegAddrDigits: number;
  sevenSegDataDigits: number;
  /** エミュレータ IO ボード受付ポート（16bit。既定 0x7148） */
  emulatePort: number;
};

export type LoadSettingAreaResult = {
  raw: Uint8Array;
  settings: IoBoardSettings;
  validMark: boolean;
};

export type InitializeResult = {
  raw: Uint8Array;
  settings: IoBoardSettings;
  initialized: boolean;
  reason: "already_valid" | "invalid_or_missing_mark" | "cpu_type_reset";
};

/**
 * 設定エリア永続化の抽象化。
 * 実機は NOR、エミュはファイル等へ接続する。
 */
export type SettingAreaStorage = {
  read(): Promise<Uint8Array | null>;
  write(raw: Uint8Array): Promise<void>;
};

/**
 * エミュレータ向けのファイル保存ストレージを作る。
 * @param filePath 設定エリアを置くファイル
 */
export function createFileSettingAreaStorage(
  filePath: string,
): SettingAreaStorage {
  return {
    async read(): Promise<Uint8Array | null> {
      try {
        const buf = await fs.readFile(filePath);
        return normalizeRaw(new Uint8Array(buf));
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        throw e;
      }
    },
    async write(raw: Uint8Array): Promise<void> {
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, Buffer.from(normalizeRaw(raw)));
    },
  };
}

/**
 * アドレス増加数を 1 または 2 に正規化する。2 以外は 1。
 * @param value 設定バイト
 * @returns 1 または 2
 */
export function normalizeAddrStep(value: number): 1 | 2 {
  return (value & 0xff) === ADDR_STEP_2 ? ADDR_STEP_2 : ADDR_STEP_1;
}

/**
 * 増加数が 2 のとき奇数アドレスを 1 減算して偶数にする。
 * @param addr 現在のアドレス
 * @param step 増加数（1 または 2）
 * @returns 整列後のアドレス
 */
export function alignAddrToStep(addr: number, step: number): number {
  const a = addr >>> 0;
  if (normalizeAddrStep(step) === ADDR_STEP_2 && (a & 1) === 1) {
    return (a - 1) >>> 0;
  }
  return a;
}

/**
 * CPU 種類ごとの既定値を返す。
 * @param cpuType CPU_TYPE（不明なら MN1613）
 */
export function defaultSettingsForCpu(cpuType: number): IoBoardSettings {
  switch (cpuType) {
    case CPU_TYPE.TMS9995:
      return {
        clockDiv: 0,
        cpuType,
        cpuTypeReset: 0,
        addrStep: ADDR_STEP_2,
        resetVector: 0,
        sevenSegAddrDigits: 0x04,
        sevenSegDataDigits: 0x04,
        emulatePort: DEFAULT_EMULATE_PORT,
      };
    case CPU_TYPE.Z8002:
      return {
        clockDiv: 0,
        cpuType,
        cpuTypeReset: 0,
        addrStep: ADDR_STEP_2,
        resetVector: 0,
        sevenSegAddrDigits: 0x04,
        sevenSegDataDigits: 0x04,
        emulatePort: DEFAULT_EMULATE_PORT,
      };
    case CPU_TYPE.MC68332:
      return {
        clockDiv: 0,
        cpuType,
        cpuTypeReset: 0,
        addrStep: ADDR_STEP_2,
        resetVector: 0,
        sevenSegAddrDigits: 0x06,
        sevenSegDataDigits: 0x04,
        emulatePort: DEFAULT_EMULATE_PORT,
      };
    case CPU_TYPE.MN1613:
    default:
      return {
        clockDiv: 0,
        cpuType: CPU_TYPE.MN1613,
        cpuTypeReset: 0,
        addrStep: ADDR_STEP_1,
        resetVector: 0x00000108,
        sevenSegAddrDigits: 0x05,
        sevenSegDataDigits: 0x04,
        emulatePort: DEFAULT_EMULATE_PORT,
      };
  }
}

/**
 * 設定エリアの生データを設定値へ変換する。
 */
export function decodeSettingArea(raw: Uint8Array): IoBoardSettings {
  const buf = normalizeRaw(raw);
  return {
    clockDiv: clampByte(buf[OFFSETS.CLOCK_DIV]) & 0x03,
    cpuType: clampByte(buf[OFFSETS.CPU_TYPE]),
    cpuTypeReset: clampByte(buf[OFFSETS.CPU_TYPE_RESET]) & 0x01,
    addrStep: normalizeAddrStep(clampByte(buf[OFFSETS.ADDR_STEP])),
    resetVector: readU32be(buf, OFFSETS.RESET_VECTOR_0),
    sevenSegAddrDigits: clampByte(buf[OFFSETS.SEVEN_SEG_ADDR_DIGITS]),
    sevenSegDataDigits: clampByte(buf[OFFSETS.SEVEN_SEG_DATA_DIGITS]),
    emulatePort: normalizeEmulatePort(readU16be(buf, OFFSETS.EMULATE_PORT_HI)),
  };
}

/**
 * 設定値を生データへ変換する（予約領域は 0xFF のまま）。
 */
export function encodeSettingArea(settings: IoBoardSettings): Uint8Array {
  const raw = new Uint8Array(SETTING_AREA_SIZE);
  raw.fill(0xff);
  writeU16be(raw, OFFSETS.MARK_HI, SETTING_MARK);
  raw[OFFSETS.CLOCK_DIV] = settings.clockDiv & 0x03;
  raw[OFFSETS.CPU_TYPE] = settings.cpuType & 0xff;
  raw[OFFSETS.CPU_TYPE_RESET] = settings.cpuTypeReset & 0x01;
  raw[OFFSETS.ADDR_STEP] = normalizeAddrStep(settings.addrStep);
  writeU32be(raw, OFFSETS.RESET_VECTOR_0, settings.resetVector >>> 0);
  raw[OFFSETS.SEVEN_SEG_ADDR_DIGITS] = settings.sevenSegAddrDigits & 0xff;
  raw[OFFSETS.SEVEN_SEG_DATA_DIGITS] = settings.sevenSegDataDigits & 0xff;
  writeU16be(
    raw,
    OFFSETS.EMULATE_PORT_HI,
    normalizeEmulatePort(settings.emulatePort),
  );
  return raw;
}

/**
 * 設定エリアへ 1 バイト書き込んだ結果を返す。
 * - 通常: 指定バイトだけ更新
 * - 04h に 1 を書いた場合: CPU種別既定値へ再設定し、04h を 0 に戻す
 */
export function writeSettingAreaByte(
  raw: Uint8Array,
  byteAddr: number,
  value: number,
): Uint8Array {
  const next = normalizeRaw(raw).slice();
  const addr = byteAddr & 0xff;
  const v = value & 0xff;
  next[addr] = v;

  if (addr !== OFFSETS.CPU_TYPE_RESET || (v & 0x01) === 0) {
    return next;
  }

  const settings = decodeSettingArea(next);
  const byCpu = defaultSettingsForCpu(settings.cpuType);
  return encodeSettingArea({
    ...byCpu,
    clockDiv: settings.clockDiv,
    cpuType: settings.cpuType,
    cpuTypeReset: 0,
  });
}

/**
 * 設定エリアをロードする。存在しない場合は既定値を返す（書き込みはしない）。
 */
export async function loadSettingArea(
  storage: SettingAreaStorage,
): Promise<LoadSettingAreaResult> {
  const saved = await storage.read();
  const raw =
    saved ?? encodeSettingArea(defaultSettingsForCpu(CPU_TYPE.MN1613));
  const validMark = saved ? hasValidMark(raw) : false;
  return {
    raw,
    settings: decodeSettingArea(raw),
    validMark,
  };
}

/**
 * 設定値を保存する。
 */
export async function saveSettingArea(
  storage: SettingAreaStorage,
  settings: IoBoardSettings,
): Promise<Uint8Array> {
  const raw = encodeSettingArea(settings);
  await storage.write(raw);
  return raw;
}

/**
 * 設定エリアを初期化する。
 * - マーク不正/未保存: 既定値を書き込む
 * - CPU種類再設定フラグ(04h=1): CPU種別に応じた既定値へ再設定し、04h を 0 に戻す
 */
export async function initializeSettingArea(
  storage: SettingAreaStorage,
): Promise<InitializeResult> {
  const loaded = await loadSettingArea(storage);
  if (!loaded.validMark) {
    const settings = defaultSettingsForCpu(CPU_TYPE.MN1613);
    const raw = await saveSettingArea(storage, settings);
    return {
      raw,
      settings,
      initialized: true,
      reason: "invalid_or_missing_mark",
    };
  }

  const settings = loaded.settings;
  if (settings.cpuTypeReset === 1) {
    const byCpu = defaultSettingsForCpu(settings.cpuType);
    const rewritten: IoBoardSettings = {
      ...byCpu,
      clockDiv: settings.clockDiv,
      cpuType: settings.cpuType,
      cpuTypeReset: 0,
    };
    const raw = await saveSettingArea(storage, rewritten);
    return {
      raw,
      settings: rewritten,
      initialized: true,
      reason: "cpu_type_reset",
    };
  }

  return {
    raw: loaded.raw,
    settings,
    initialized: false,
    reason: "already_valid",
  };
}

function hasValidMark(raw: Uint8Array): boolean {
  const buf = normalizeRaw(raw);
  return readU16be(buf, OFFSETS.MARK_HI) === SETTING_MARK;
}

function normalizeRaw(raw: Uint8Array): Uint8Array {
  if (raw.length === SETTING_AREA_SIZE) return raw;
  const out = new Uint8Array(SETTING_AREA_SIZE);
  out.fill(0xff);
  out.set(raw.subarray(0, SETTING_AREA_SIZE));
  return out;
}

function clampByte(v: number | undefined): number {
  return (v ?? 0) & 0xff;
}

/**
 * 受付ポートを 1–65535 に正規化する。0 と未書き込み相当 0xFFFF は既定値。
 * @param value 16bit ポート番号
 */
function normalizeEmulatePort(value: number): number {
  const p = value & 0xffff;
  if (p === 0 || p === 0xffff) return DEFAULT_EMULATE_PORT;
  return p;
}

function readU16be(raw: Uint8Array, offset: number): number {
  return ((raw[offset] ?? 0) << 8) | (raw[offset + 1] ?? 0);
}

function writeU16be(raw: Uint8Array, offset: number, value: number): void {
  raw[offset] = (value >>> 8) & 0xff;
  raw[offset + 1] = value & 0xff;
}

function readU32be(raw: Uint8Array, offset: number): number {
  return (
    (((raw[offset] ?? 0) << 24) |
      ((raw[offset + 1] ?? 0) << 16) |
      ((raw[offset + 2] ?? 0) << 8) |
      (raw[offset + 3] ?? 0)) >>>
    0
  );
}

function writeU32be(raw: Uint8Array, offset: number, value: number): void {
  raw[offset] = (value >>> 24) & 0xff;
  raw[offset + 1] = (value >>> 16) & 0xff;
  raw[offset + 2] = (value >>> 8) & 0xff;
  raw[offset + 3] = value & 0xff;
}
