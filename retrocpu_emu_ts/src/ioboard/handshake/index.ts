/**
 * 制御・I/O ボード側ハンドシェイク（TypeScript）
 * 根拠: HandShake.mdc
 *
 * CPU ボード側は MN1613 アセンブラ（retrocpu_boot_monitor/mn1613/src/handshake/）
 */

export { IoControlHandshake } from "../../shared/handshake/handshake_ioboard";
export {
  createHandshakeBus,
  INT_CAUSE_CODE,
  intCauseForTimer,
  DEFAULT_TIMEOUT_MS,
} from "../../shared/handshake/handshake_type";
export {
  createHandshakeIoPortBridge,
  IO_PORT,
  HSHK_CTRL_BIT,
  type HandshakeIoPortBridge,
} from "../../cpuboard/handshake/io_port_bridge";
export {
  IoBoardHandshakeMock,
  createIoBoardHandshakeMock,
  createDefaultCpuToIoHandlers,
  createIoBoardCommandState,
  resetIoBoardCommandState,
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
} from "../timer/io_timer";
export {
  IoTimeCounter,
  IO_TIME_TICK_NS,
  type IoTimeSource,
} from "../timer/io_time";
export { CpuHandshakeAgent } from "../../cpuboard/cpu_hshk_agent";
