/**
 * CPU コアの種別に応じた API 束ね。
 * Worker / DMA / ブートはここ経由で MN1613 / TMS9995 を切り替える。
 */

import { CPU_TYPE } from "../ioboard/setting_area";
import * as mn1613 from "./mn1613/mn1613";
import * as tms9995 from "./tms9995/tms9995";

export type CpuCoreModule = typeof mn1613;

/**
 * cpuType に対応する命令コア API を返す。
 * @param cpuType 1=MN1613 / 2=TMS9995
 */
export function getCpuCore(cpuType: number): CpuCoreModule {
  return cpuType === CPU_TYPE.TMS9995 ? (tms9995 as unknown as CpuCoreModule) : mn1613;
}

/** 命令コアが Worker で実行可能か */
export function isCpuCoreReady(cpuType: number): boolean {
  return cpuType === CPU_TYPE.MN1613 || cpuType === CPU_TYPE.TMS9995;
}
