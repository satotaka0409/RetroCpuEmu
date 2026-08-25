/**
 * Cursor 拡張 ↔ IO ボードのアドレス／IO ブレイク（10h / 11h）
 * 根拠: retrocpu_debug.mdc「アドレスブレイク設定」「メモリ/IOブレイク解除」
 * 線上レイアウトは HandShake.mdc と同じ。TCP も同じバイナリを載せる。
 */

import {
  ADDR_BREAK_CLR_FRAME_LEN,
  ADDR_BREAK_SET_FRAME_LEN,
  ADDR_BREAK_SET_PAYLOAD_LEN,
  ADDR_BREAK_SLOT_COUNT,
  CMD_IO_TO_CPU,
  DEBUG_MEM_MAX_BYTES,
  MEM_READ_REQ_FRAME_LEN,
  MEM_WRITE_REQ_HEADER_LEN,
  RESPONSE_CODE,
} from "../shared/handshake/handshake_type";

/** 10h 設定フレーム（コマンド除くフィールド） */
export type AddrBreakSetFields = {
  /** スロット 0–3 */
  slot: number;
  /** 位置02。Bit0 MEM/IO, Bit1 RD_EN, Bit2 WR_EN, Bit3–5 条件, Bit6 INST, Bit7 履歴 */
  flags: number;
  /** ブレイクまでのカウント。0=シングル、1–255=回数 */
  count: number;
  /** 監視アドレス（32bit。MEM はバイト、IO は下位 16bit） */
  addr: number;
  /** 比較データ（16bit） */
  data: number;
};

/**
 * 10h の TCP／線上フレーム（10 バイト）を組み立てる。
 * @param fields スロット・フラグ・アドレス・比較データ
 * @returns cmd + 9 バイト
 */
export function encodeAddrBreakSetFrame(
  fields: AddrBreakSetFields,
): Uint8Array {
  const addr = fields.addr >>> 0;
  const data = fields.data & 0xffff;
  return Uint8Array.from([
    CMD_IO_TO_CPU.BREAK_MEM_IO_SET,
    fields.slot & 0xff,
    fields.flags & 0xff,
    fields.count & 0xff,
    (addr >>> 24) & 0xff,
    (addr >>> 16) & 0xff,
    (addr >>> 8) & 0xff,
    addr & 0xff,
    (data >>> 8) & 0xff,
    data & 0xff,
  ]);
}

/**
 * 10h フレームからフィールドを読む。長さ・コマンドが違うと null。
 * @param frame 受信バイト（先頭が 10h、長さ 10）
 * @returns フィールド。不正なら null
 */
export function parseAddrBreakSetFrame(
  frame: Uint8Array,
): AddrBreakSetFields | null {
  if (frame.length < ADDR_BREAK_SET_FRAME_LEN) return null;
  if (frame[0] !== CMD_IO_TO_CPU.BREAK_MEM_IO_SET) return null;
  return {
    slot: frame[1]! & 0xff,
    flags: frame[2]! & 0xff,
    count: frame[3]! & 0xff,
    addr:
      ((frame[4]! << 24) | (frame[5]! << 16) | (frame[6]! << 8) | frame[7]!) >>>
      0,
    data: ((frame[8]! << 8) | frame[9]!) & 0xffff,
  };
}

/**
 * 10h のコマンド除く 9 バイトを取り出す。
 * @param frame 10 バイトフレーム
 * @returns payload。不正なら null
 */
export function addrBreakSetPayload(frame: Uint8Array): Uint8Array | null {
  if (parseAddrBreakSetFrame(frame) === null) return null;
  return frame.subarray(1, 1 + ADDR_BREAK_SET_PAYLOAD_LEN);
}

/**
 * 11h フレーム（cmd + slot）を組み立てる。
 * @param slot ブレイク設定番号（0–3）
 * @returns 2 バイト
 */
export function encodeAddrBreakClrFrame(slot: number): Uint8Array {
  return Uint8Array.from([CMD_IO_TO_CPU.BREAK_MEM_IO_CLR, slot & 0xff]);
}

/**
 * 11h のスロット番号を読む。
 * @param frame 受信バイト（先頭が 11h、長さ 2）
 * @returns スロット。不正なら null
 */
export function parseAddrBreakClrSlot(frame: Uint8Array): number | null {
  if (frame.length < ADDR_BREAK_CLR_FRAME_LEN) return null;
  if (frame[0] !== CMD_IO_TO_CPU.BREAK_MEM_IO_CLR) return null;
  return frame[1]! & 0xff;
}

/**
 * スロットが 0–3 か。
 * @param slot 設定番号
 * @returns 範囲内なら true
 */
export function isAddrBreakSlot(slot: number): boolean {
  return slot >= 0 && slot < ADDR_BREAK_SLOT_COUNT;
}

/**
 * 受信バッファから次フレームの必要長を返す。ヘッダ不足なら null。
 * 14h は count がヘッダに入ってから全長が決まる。
 * @param buf 未処理受信
 * @returns 必要バイト数。まだ足りないときは null
 */
export function debugPcNeededBytes(buf: Uint8Array): number | null {
  if (buf.length < 1) return null;
  const cmd = buf[0]!;
  if (cmd === CMD_IO_TO_CPU.MEM_WRITE) {
    if (buf.length < MEM_WRITE_REQ_HEADER_LEN) return null;
    const n =
      ((buf[5]! << 24) | (buf[6]! << 16) | (buf[7]! << 8) | buf[8]!) >>> 0;
    if (n > DEBUG_MEM_MAX_BYTES) return MEM_WRITE_REQ_HEADER_LEN;
    return MEM_WRITE_REQ_HEADER_LEN + n;
  }
  return debugPcFrameLength(cmd);
}

/**
 * コマンド先頭バイトから、続きを含めた必要バイト数を返す。
 * 未知コマンドは 1（そのバイトだけ消費して NG）。
 * 14h は可変長なので {@link debugPcNeededBytes} を使う。
 * @param cmd 先頭バイト
 * @returns フレーム全長
 */
export function debugPcFrameLength(cmd: number): number {
  if (cmd === CMD_IO_TO_CPU.BREAK_MEM_IO_SET) return ADDR_BREAK_SET_FRAME_LEN;
  if (cmd === CMD_IO_TO_CPU.BREAK_MEM_IO_CLR) return ADDR_BREAK_CLR_FRAME_LEN;
  if (cmd === CMD_IO_TO_CPU.MEM_READ) return MEM_READ_REQ_FRAME_LEN;
  if (cmd === CMD_IO_TO_CPU.MEM_WRITE) return MEM_WRITE_REQ_HEADER_LEN;
  return 1;
}

export {
  ADDR_BREAK_CLR_FRAME_LEN,
  ADDR_BREAK_SET_FRAME_LEN,
  ADDR_BREAK_SET_PAYLOAD_LEN,
  ADDR_BREAK_SLOT_COUNT,
  RESPONSE_CODE,
};
