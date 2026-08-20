/**
 * TMS9995 固有のテスト補助。
 * 現段階では呼び出し規約（引数配置）ユーティリティを提供する。
 */

export {
  TMS9995_DEFAULT_ARG_REGISTERS,
  TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS,
  planTms9995Call,
  validateTms9995ArgRegisters,
} from "./calling_convention.js";
export {
  Tms9995CruHandshakeMock,
  TMS9995_CRU_HANDSHAKE_REGION,
  TMS9995_CRU_HANDSHAKE_SIGNALS,
} from "./cru_handshake.js";
export type {
  Tms9995CruActor,
  Tms9995CruBit,
  Tms9995CruCpuInSignal,
  Tms9995CruCpuOutSignal,
  Tms9995CruHandshakeOptions,
  Tms9995CruHandshakeSnapshot,
  Tms9995CruReadLog,
  Tms9995CruSignalName,
  Tms9995CruWriteLog,
  Tms9995CallPlan,
  Tms9995CallPlanOptions,
  Tms9995CallDiagnostics,
  Tms9995ArgLocation,
  Tms9995StackWord,
} from "./types.js";
