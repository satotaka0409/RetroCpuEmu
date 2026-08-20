import type { JsonTestSettings } from "../../../retrocpu_test_framework/src/index.js";

/** TMS9995 monitor 成果物の既定パス。 */
export const tms9995MonSettings: JsonTestSettings = {
  name: "tms9995_mon",
  cpu: "tms9995",
  hexFile:
    "${REPO_ROOT}/retrocpu_boot_monitor/build/hex/tms9995/tms9995_mon.ihx",
  cdbFile:
    "${REPO_ROOT}/retrocpu_boot_monitor/build/hex/tms9995/tms9995_mon.cdb",
  initLabel: null,
};
