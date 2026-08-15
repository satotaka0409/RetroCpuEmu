/**
 * Cursor 拡張 ↔ IO ボードのメモリ読み出し（TCP 13h → ハンドシェイク 13h）
 * 根拠: HandShake.mdc メモリ読み出し、retrocpu_debug.mdc メモリダンプ
 */

import {
  CMD_IO_TO_CPU,
  MEM_READ_REQ_FRAME_LEN,
} from "../shared/handshake/handshake_type";

/** 13h 要求（コマンド除く） */
export type MemReadReq = {
  /** 開始バイトアドレス */
  byteAddr: number;
  /** 読み出しバイト数 */
  byteCount: number;
};

/**
 * 13h 要求フレームを組み立てる。
 * @param byteAddr 開始バイトアドレス
 * @param byteCount バイト数
 * @returns cmd + addr32 BE + count32 BE
 */
export function encodeMemReadFrame(
  byteAddr: number,
  byteCount: number,
): Uint8Array {
  const a = byteAddr >>> 0;
  const n = byteCount >>> 0;
  return Uint8Array.from([
    CMD_IO_TO_CPU.MEM_READ,
    (a >>> 24) & 0xff,
    (a >>> 16) & 0xff,
    (a >>> 8) & 0xff,
    a & 0xff,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

/**
 * 13h 要求を読む。
 * @param frame 先頭が 13h、長さ 9
 * @returns フィールド。不正なら null
 */
export function parseMemReadFrame(frame: Uint8Array): MemReadReq | null {
  if (frame.length < MEM_READ_REQ_FRAME_LEN) return null;
  if (frame[0] !== CMD_IO_TO_CPU.MEM_READ) return null;
  const byteAddr =
    ((frame[1]! << 24) |
      (frame[2]! << 16) |
      (frame[3]! << 8) |
      frame[4]!) >>>
    0;
  const byteCount =
    ((frame[5]! << 24) |
      (frame[6]! << 16) |
      (frame[7]! << 8) |
      frame[8]!) >>>
    0;
  return { byteAddr, byteCount };
}
