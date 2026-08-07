/**
 * 制御・I/O ボード側ハンドシェイク（TypeScript）
 * 根拠: HandShake.mdc
 *
 * CPU ボード側は MN1613 アセンブラ（retrocpu_boot_monitor/mn1613/src/handshake/）
 */

export { IoControlHandshake } from "../../cpu/mn1613/handhshake/handshake_ioboard";
export {
  createHandshakeBus,
  INT_CAUSE_CODE,
  intCauseForTimer,
  DEFAULT_TIMEOUT_MS,
} from "../../cpu/mn1613/handhshake/handshake_type";
export {
  createHandshakeIoPortBridge,
  IO_PORT,
  HSHK_CTRL_BIT,
} from "./io_port_bridge";
export {
  IoBoardHandshakeMock,
  createIoBoardHandshakeMock,
  createDefaultCpuToIoHandlers,
  createIoBoardCommandState,
  wireHshkReq1ToIrq2,
  type IoBoardMockOptions,
  type IoBoardMockState,
  type IoBoardMockLogEntry,
} from "./io_board_mock";
export {
  IoTimer,
  type IoTimerConfig,
  type IoTimerScheduler,
  type IoTimerState,
} from "../io_timer";
export { CpuHandshakeAgent } from "../cpu_hshk_agent";
