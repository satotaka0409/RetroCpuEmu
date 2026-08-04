/**
 * 制御・I/O ボード側ハンドシェイク（TypeScript）
 * 根拠: HandShake.mdc
 *
 * CPU ボード側は MN1613 アセンブラ（cursor_expand/monitor/mn1613/src/handshake/）
 */

export { IoControlHandshake } from "../../cpu/mn1613/handhshake/handshake_ioboard";
export {
  createHandshakeBus,
  INT_CAUSE_CODE,
  DEFAULT_TIMEOUT_MS,
} from "../../cpu/mn1613/handhshake/handshake_type";
export {
  createHandshakeIoPortBridge,
  IO_PORT,
  HSHK_CTRL_BIT,
} from "./io_port_bridge";
