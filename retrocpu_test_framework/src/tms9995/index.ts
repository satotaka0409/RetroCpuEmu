/**
 * TMS9995 固有のテスト補助。
 * 成果物セッション・呼び出し規約・CRU モック。実行セッションは CPU エミュ待ち。
 */

export {
  TMS9995_DEFAULT_ARG_REGISTERS,
  TMS9995_MONITOR_ARG_REGISTERS,
  TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS,
  TMS9995_DEFAULT_STACK_INIT,
  TMS9995_DEFAULT_WORKSPACE,
  planTms9995Call,
  validateTms9995ArgRegisters,
} from "./calling_convention.js";
export {
  Tms9995CruHandshakeMock,
  TMS9995_CRU_HANDSHAKE_REGION,
  TMS9995_CRU_HANDSHAKE_SIGNALS,
} from "./cru_handshake.js";
export {
  parseTms9995Cdb,
  requireTms9995Symbol,
  emptyTms9995CdbTable,
} from "./cdb.js";
export {
  Tms9995ArtifactSession,
  createTms9995ArtifactSession,
} from "./session.js";
export type { Tms9995SessionOptions } from "./session.js";
export { createTms9995SessionFromSettings } from "./settings_session.js";
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
