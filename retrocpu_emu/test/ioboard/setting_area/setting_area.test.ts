/**
 * IOボード設定エリア（save/load/initialize）
 * 根拠: ioboard.mdc 「IOボード設定エリア」（00h–0Dh）
 */

import { describe, it, expect } from "vitest";
import {
  ADDR_STEP_1,
  ADDR_STEP_2,
  CPU_TYPE,
  DEFAULT_EMULATE_PORT,
  OFFSETS,
  SETTING_AREA_SIZE,
  SETTING_MARK,
  alignAddrToStep,
  defaultSettingsForCpu,
  encodeSettingArea,
  initializeSettingArea,
  loadSettingArea,
  saveSettingArea,
  writeSettingAreaByte,
  type IoBoardSettings,
  type SettingAreaStorage,
} from "../../../src/ioboard/setting_area/setting_area";

type MemoryStorage = SettingAreaStorage & {
  peek(): Uint8Array | null;
};

function createMemoryStorage(initial?: Uint8Array | null): MemoryStorage {
  let raw = initial ? initial.slice() : null;
  return {
    async read(): Promise<Uint8Array | null> {
      return raw ? raw.slice() : null;
    },
    async write(next: Uint8Array): Promise<void> {
      raw = next.slice();
    },
    peek(): Uint8Array | null {
      return raw ? raw.slice() : null;
    },
  };
}

/** テスト用の MN1613 設定（clockDiv だけ変えるとき用） */
function mn1613Settings(partial: Partial<IoBoardSettings> = {}): IoBoardSettings {
  return {
    ...defaultSettingsForCpu(CPU_TYPE.MN1613),
    ...partial,
  };
}

describe("setting_area", () => {
  it("オフセットは ioboard.mdc の 00h–0Dh に一致する", () => {
    expect(OFFSETS).toEqual({
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
    });
  });

  it("save -> load で値を保持する", async () => {
    const storage = createMemoryStorage();
    await saveSettingArea(
      storage,
      mn1613Settings({
        clockDiv: 2,
        addrStep: ADDR_STEP_1,
      }),
    );

    const loaded = await loadSettingArea(storage);
    expect(loaded.validMark).toBe(true);
    expect(loaded.settings).toEqual(
      mn1613Settings({
        clockDiv: 2,
        addrStep: ADDR_STEP_1,
      }),
    );
    const raw = storage.peek()!;
    expect(raw[OFFSETS.ADDR_STEP]).toBe(ADDR_STEP_1);
    expect(raw[OFFSETS.RESET_VECTOR_0]).toBe(0x00);
    expect(raw[OFFSETS.RESET_VECTOR_3]).toBe(0x08);
    expect(raw[OFFSETS.SEVEN_SEG_ADDR_DIGITS]).toBe(0x05);
    expect(raw[OFFSETS.SEVEN_SEG_DATA_DIGITS]).toBe(0x04);
    expect(raw[OFFSETS.EMULATE_PORT_HI]).toBe(
      (DEFAULT_EMULATE_PORT >>> 8) & 0xff,
    );
    expect(raw[OFFSETS.EMULATE_PORT_LO]).toBe(DEFAULT_EMULATE_PORT & 0xff);
  });

  it("未保存またはマーク不正なら初期化し既定値を書き込む", async () => {
    const storage = createMemoryStorage(null);
    const inited = await initializeSettingArea(storage);

    expect(inited.initialized).toBe(true);
    expect(inited.reason).toBe("invalid_or_missing_mark");
    expect(inited.settings).toEqual(defaultSettingsForCpu(CPU_TYPE.MN1613));
    const raw = storage.peek();
    expect(raw).not.toBeNull();
    expect(raw?.length).toBe(SETTING_AREA_SIZE);
    expect(raw?.[OFFSETS.MARK_HI]).toBe((SETTING_MARK >>> 8) & 0xff);
    expect(raw?.[OFFSETS.MARK_LO]).toBe(SETTING_MARK & 0xff);
  });

  it("マークを壊して初期化すると MN1613 既定に戻る", async () => {
    const raw = encodeSettingArea(
      mn1613Settings({
        clockDiv: 3,
        cpuType: CPU_TYPE.TMS9995,
        addrStep: ADDR_STEP_2,
        resetVector: 0x11223344,
      }),
    );
    raw[OFFSETS.MARK_HI] = 0x00;
    raw[OFFSETS.MARK_LO] = 0x00;
    const storage = createMemoryStorage(raw);

    const inited = await initializeSettingArea(storage);
    expect(inited.initialized).toBe(true);
    expect(inited.reason).toBe("invalid_or_missing_mark");
    expect(inited.settings).toEqual(defaultSettingsForCpu(CPU_TYPE.MN1613));
  });

  it("CPU種類再設定フラグ(04h=1)ならCPU既定値へ再設定して04hを戻す", async () => {
    const raw = encodeSettingArea({
      clockDiv: 3,
      cpuType: CPU_TYPE.MC68332,
      cpuTypeReset: 1,
      addrStep: ADDR_STEP_1,
      resetVector: 0x11223344,
      sevenSegAddrDigits: 0x00,
      sevenSegDataDigits: 0x00,
      emulatePort: 0x1234,
    });
    const storage = createMemoryStorage(raw);

    const inited = await initializeSettingArea(storage);
    expect(inited.initialized).toBe(true);
    expect(inited.reason).toBe("cpu_type_reset");
    expect(inited.settings.clockDiv).toBe(3);
    expect(inited.settings.cpuType).toBe(CPU_TYPE.MC68332);
    expect(inited.settings.cpuTypeReset).toBe(0);
    expect(inited.settings.addrStep).toBe(ADDR_STEP_2);
    expect(inited.settings.resetVector).toBe(0);
    expect(inited.settings.sevenSegAddrDigits).toBe(0x06);
    expect(inited.settings.sevenSegDataDigits).toBe(0x04);
  });

  it("有効マークかつ再設定フラグなしなら初期化しない", async () => {
    const storage = createMemoryStorage(
      encodeSettingArea(defaultSettingsForCpu(CPU_TYPE.Z8002)),
    );

    const result = await initializeSettingArea(storage);
    expect(result.initialized).toBe(false);
    expect(result.reason).toBe("already_valid");
    expect(result.settings.cpuType).toBe(CPU_TYPE.Z8002);
    expect(result.settings.addrStep).toBe(ADDR_STEP_2);
    expect(result.settings.sevenSegDataDigits).toBe(0x04);
  });

  it("04h に 1 を書くと CPU 既定値へ再設定され、04h は 0 に戻る", () => {
    const raw = encodeSettingArea({
      clockDiv: 2,
      cpuType: CPU_TYPE.TMS9995,
      cpuTypeReset: 0,
      addrStep: ADDR_STEP_1,
      resetVector: 0x11223344,
      sevenSegAddrDigits: 0x09,
      sevenSegDataDigits: 0x09,
      emulatePort: 0x1234,
    });

    const written = writeSettingAreaByte(raw, OFFSETS.CPU_TYPE_RESET, 1);
    const loaded = loadFromRaw(written);
    expect(loaded.cpuType).toBe(CPU_TYPE.TMS9995);
    expect(loaded.clockDiv).toBe(2);
    expect(loaded.cpuTypeReset).toBe(0);
    expect(loaded.addrStep).toBe(ADDR_STEP_2);
    expect(loaded.resetVector).toBe(0);
    expect(loaded.sevenSegAddrDigits).toBe(0x04);
    expect(loaded.sevenSegDataDigits).toBe(0x04);
  });

  it("増加数 2 のとき奇数アドレスはアクション前に -1 する", () => {
    expect(alignAddrToStep(0x1001, ADDR_STEP_2)).toBe(0x1000);
    expect(alignAddrToStep(0x1000, ADDR_STEP_2)).toBe(0x1000);
    expect(alignAddrToStep(0x1001, ADDR_STEP_1)).toBe(0x1001);
  });
});

/**
 * 生バイトから設定フィールドを拾う（オフセット固定の確認用）。
 * @param raw 設定エリア
 */
function loadFromRaw(raw: Uint8Array) {
  return {
    clockDiv: raw[OFFSETS.CLOCK_DIV]! & 0x03,
    cpuType: raw[OFFSETS.CPU_TYPE]! & 0xff,
    cpuTypeReset: raw[OFFSETS.CPU_TYPE_RESET]! & 0x01,
    addrStep: raw[OFFSETS.ADDR_STEP]! & 0xff,
    resetVector:
      (((raw[OFFSETS.RESET_VECTOR_0] ?? 0) << 24) |
        ((raw[OFFSETS.RESET_VECTOR_1] ?? 0) << 16) |
        ((raw[OFFSETS.RESET_VECTOR_2] ?? 0) << 8) |
        (raw[OFFSETS.RESET_VECTOR_3] ?? 0)) >>>
      0,
    sevenSegAddrDigits: raw[OFFSETS.SEVEN_SEG_ADDR_DIGITS]! & 0xff,
    sevenSegDataDigits: raw[OFFSETS.SEVEN_SEG_DATA_DIGITS]! & 0xff,
    emulatePort:
      ((raw[OFFSETS.EMULATE_PORT_HI] ?? 0) << 8) |
      (raw[OFFSETS.EMULATE_PORT_LO] ?? 0),
  };
}
