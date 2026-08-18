import { describe, expect, it } from "vitest";
import {
  createDefaultStartupConfig,
  parseStartupConfigObject,
} from "../../src/electron/startup_config";
import {
  ADDR_STEP_1,
  ADDR_STEP_2,
  CPU_TYPE,
} from "../../src/ioboard/setting_area";

describe("startup_config", () => {
  it("JSON 未指定相当は MN1613 既定値になる", () => {
    const cfg = createDefaultStartupConfig();
    expect(cfg.settings.cpuType).toBe(CPU_TYPE.MN1613);
    expect(cfg.settings.clockDiv).toBe(0);
    expect(cfg.settings.addrStep).toBe(ADDR_STEP_1);
    expect(cfg.settings.resetVector).toBe(0x0108);
    expect(cfg.settings.sevenSegAddrDigits).toBe(0x05);
    expect(cfg.settings.sevenSegDataDigits).toBe(0x04);
  });

  it("起動 JSON の文字列値を設定へ反映する", () => {
    const cfg = parseStartupConfigObject({
      clock: "2",
      cpu: "2",
      address_addcount: "2",
      reset_vector: "0x00001234",
      sevenseg_adddress_digit: "4",
      sevenseg_data_digit: "6",
      emulate_port: "29001",
    });
    expect(cfg.settings.cpuType).toBe(CPU_TYPE.TMS9995);
    expect(cfg.settings.clockDiv).toBe(2);
    expect(cfg.settings.addrStep).toBe(ADDR_STEP_2);
    expect(cfg.settings.resetVector).toBe(0x00001234);
    expect(cfg.settings.sevenSegAddrDigits).toBe(0x04);
    expect(cfg.settings.sevenSegDataDigits).toBe(0x06);
    expect(cfg.emulatePort).toBe(29001);
  });

  it("不正値は既定値へフォールバックする", () => {
    const cfg = parseStartupConfigObject({
      clock: "9",
      cpu: "999",
      address_addcount: "0",
      reset_vector: "bad",
      emulate_port: "70000",
    });
    expect(cfg.settings.cpuType).toBe(CPU_TYPE.MN1613);
    expect(cfg.settings.clockDiv).toBe(0);
    expect(cfg.settings.addrStep).toBe(ADDR_STEP_1);
    expect(cfg.settings.resetVector).toBe(0x0108);
    expect(cfg.emulatePort).toBeUndefined();
  });
});
