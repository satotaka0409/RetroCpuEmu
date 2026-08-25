/**
 * IO→CPU ハンドシェイク REQ を CPU 割込へ反映する配線。
 * MN1613: INT2 / ハンドシェイク。TMS9995: INT1 / ハンドシェイク（HandShake.mdc）。
 */

import { CPU_TYPE } from "../ioboard/setting_area";
import { HSHK_IN_REQ_NO_IRQ } from "../shared/handshake/handshake_type";
import type { CpuIoSignals } from "./mn1613/mn1613ioport";
import { getCpuCore } from "./cpu_core";
import { setIntCause } from "./io_ports";

/**
 * HSHK_IN_REQ の立ち上がりを CPU 割込へ反映する。
 * @param bus ハンドシェイク信号バス
 * @param cpuType setting_area の CPU 種別（1=MN1613, 2=TMS9995）
 * @returns 配線解除関数
 */
export function wireHshkInReqToCpuIrq(
  bus: CpuIoSignals,
  cpuType: number,
): () => void {
  const irqLevel = cpuType === CPU_TYPE.TMS9995 ? 1 : 2;
  const core = () => getCpuCore(cpuType);
  let req1: 0 | 1 = bus.HSHK_IN_REQ;

  Object.defineProperty(bus, "HSHK_IN_REQ", {
    configurable: true,
    enumerable: true,
    get(): 0 | 1 {
      return req1;
    },
    set(v: number) {
      const next: 0 | 1 = v ? 1 : 0;
      if (next === req1) return;
      req1 = next;
      const noIrq = Boolean(
        (bus as CpuIoSignals & { [HSHK_IN_REQ_NO_IRQ]?: boolean })[
          HSHK_IN_REQ_NO_IRQ
        ],
      );
      if (next === 1 && !noIrq) {
        setIntCause(bus.INT_CAUSE & 0x07);
        if (irqLevel === 1) {
          core().setPins({ IRQ1: true });
          core().triggerInterrupt(1);
          core().setPins({ IRQ1: false });
        } else {
          core().setPins({ IRQ2: true });
          core().triggerInterrupt(2);
          core().setPins({ IRQ2: false });
        }
        return;
      }
      if (next === 0) {
        if (irqLevel === 1) core().setPins({ IRQ1: false });
        else core().setPins({ IRQ2: false });
      }
    },
  });

  return () => {
    Object.defineProperty(bus, "HSHK_IN_REQ", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: req1,
    });
    core().setPins({ IRQ1: false, IRQ2: false });
  };
}
