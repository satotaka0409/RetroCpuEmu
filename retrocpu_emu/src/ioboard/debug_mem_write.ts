/**
 * Cursor 拡張 ↔ IO ボードのメモリ書き込み（TCP 84h → ハンドシェイク 84h）
 * 根拠: HandShake.mdc メモリ書き込み、retrocpu_debug.mdc メモリダンプ
 */

import {
  CMD_IO_TO_CPU,
  DEBUG_MEM_MAX_BYTES,
  MEM_WRITE_REQ_HEADER_LEN,
} from "../shared/handshake/handshake_type";

/** 84h 要求（ヘッダ＋データ） */
export type MemWriteReq = {
  /** 開始バイトアドレス */
  byteAddr: number;
  /** 書き込むバイト列 */
  data: Uint8Array;
};

/**
 * 84h 要求フレームを組み立てる。
 * @param byteAddr 開始バイトアドレス
 * @param data 書き込むバイト列
 * @returns cmd + addr32 BE + count32 BE + data
 */
export function encodeMemWriteFrame(
  byteAddr: number,
  data: Uint8Array,
): Uint8Array {
  const a = byteAddr >>> 0;
  const n = data.byteLength >>> 0;
  const out = new Uint8Array(MEM_WRITE_REQ_HEADER_LEN + n);
  out[0] = CMD_IO_TO_CPU.MEM_WRITE;
  out[1] = (a >>> 24) & 0xff;
  out[2] = (a >>> 16) & 0xff;
  out[3] = (a >>> 8) & 0xff;
  out[4] = a & 0xff;
  out[5] = (n >>> 24) & 0xff;
  out[6] = (n >>> 16) & 0xff;
  out[7] = (n >>> 8) & 0xff;
  out[8] = n & 0xff;
  out.set(data, MEM_WRITE_REQ_HEADER_LEN);
  return out;
}

/**
 * 84h 要求を読む。
 * @param frame 先頭が 84h、長さ 9+count
 * @returns フィールド。不正なら null
 */
export function parseMemWriteFrame(frame: Uint8Array): MemWriteReq | null {
  if (frame.length < MEM_WRITE_REQ_HEADER_LEN) return null;
  if (frame[0] !== CMD_IO_TO_CPU.MEM_WRITE) return null;
  const byteAddr =
    ((frame[1]! << 24) | (frame[2]! << 16) | (frame[3]! << 8) | frame[4]!) >>>
    0;
  const byteCount =
    ((frame[5]! << 24) | (frame[6]! << 16) | (frame[7]! << 8) | frame[8]!) >>>
    0;
  if (byteCount > DEBUG_MEM_MAX_BYTES) return null;
  if (frame.length < MEM_WRITE_REQ_HEADER_LEN + byteCount) return null;
  return {
    byteAddr,
    data: frame.subarray(
      MEM_WRITE_REQ_HEADER_LEN,
      MEM_WRITE_REQ_HEADER_LEN + byteCount,
    ),
  };
}
