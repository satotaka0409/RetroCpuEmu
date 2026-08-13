/**
 * Cursor 拡張 ↔ IO ボードのアドレス／IO ブレイク（40h / 41h）
 * 根拠: retrocpu_debug.mdc「アドレスブレイク設定」「メモリ/IOブレイク解除」
 * 線上レイアウトは HandShake.mdc と同じ。TCP も同じバイナリを載せる。
 */

import {
  ADDR_BREAK_CLR_FRAME_LEN,
  ADDR_BREAK_SET_FRAME_LEN,
  ADDR_BREAK_SET_PAYLOAD_LEN,
  ADDR_BREAK_SLOT_COUNT,
  CMD_IO_TO_CPU,
  RESPONSE_CODE,
} from "../shared/handshake/handshake_type";

/** 40h 設定フレーム（コマンド除くフィールド） */
export type AddrBreakSetFields = {
  /** スロット 0–5 */
  slot: number;
  /** 位置02 上位バイト。Bit0 MEM/IO, Bit1 RD/WR, Bit2–4 条件, Bit5 履歴 */
  flags: number;
  /** ブレイクまでのカウント。0=シングル、1–255=回数 */
  count: number;
  /** 監視アドレス（32bit。MEM はバイト、IO は下位 16bit） */
  addr: number;
  /** 比較データ（16bit） */
  data: number;
};

/**
 * 40h の TCP／線上フレーム（10 バイト）を組み立てる。
 * @param fields スロット・フラグ・アドレス・比較データ
 * @returns cmd + 9 バイト
 */
export function encodeAddrBreakSetFrame(fields: AddrBreakSetFields): Uint8Array {
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
 * 40h フレームからフィールドを読む。長さ・コマンドが違うと null。
 * @param frame 受信バイト（先頭が 40h、長さ 10）
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
      ((frame[4]! << 24) |
        (frame[5]! << 16) |
        (frame[6]! << 8) |
        frame[7]!) >>>
      0,
    data: ((frame[8]! << 8) | frame[9]!) & 0xffff,
  };
}

/**
 * 40h のコマンド除く 9 バイトを取り出す。
 * @param frame 10 バイトフレーム
 * @returns payload。不正なら null
 */
export function addrBreakSetPayload(frame: Uint8Array): Uint8Array | null {
  if (parseAddrBreakSetFrame(frame) === null) return null;
  return frame.subarray(1, 1 + ADDR_BREAK_SET_PAYLOAD_LEN);
}

/**
 * 41h フレーム（cmd + slot）を組み立てる。
 * @param slot ブレイク設定番号（0–5）
 * @returns 2 バイト
 */
export function encodeAddrBreakClrFrame(slot: number): Uint8Array {
  return Uint8Array.from([CMD_IO_TO_CPU.BREAK_MEM_IO_CLR, slot & 0xff]);
}

/**
 * 41h のスロット番号を読む。
 * @param frame 受信バイト（先頭が 41h、長さ 2）
 * @returns スロット。不正なら null
 */
export function parseAddrBreakClrSlot(frame: Uint8Array): number | null {
  if (frame.length < ADDR_BREAK_CLR_FRAME_LEN) return null;
  if (frame[0] !== CMD_IO_TO_CPU.BREAK_MEM_IO_CLR) return null;
  return frame[1]! & 0xff;
}

/**
 * スロットが 0–5 か。
 * @param slot 設定番号
 * @returns 範囲内なら true
 */
export function isAddrBreakSlot(slot: number): boolean {
  return slot >= 0 && slot < ADDR_BREAK_SLOT_COUNT;
}

/**
 * コマンド先頭バイトから、続きを含めた必要バイト数を返す。
 * 未知コマンドは 1（そのバイトだけ消費して NG）。
 * @param cmd 先頭バイト
 * @returns フレーム全長
 */
export function debugPcFrameLength(cmd: number): number {
  if (cmd === CMD_IO_TO_CPU.BREAK_MEM_IO_SET) return ADDR_BREAK_SET_FRAME_LEN;
  if (cmd === CMD_IO_TO_CPU.BREAK_MEM_IO_CLR) return ADDR_BREAK_CLR_FRAME_LEN;
  return 1;
}

export {
  ADDR_BREAK_CLR_FRAME_LEN,
  ADDR_BREAK_SET_FRAME_LEN,
  ADDR_BREAK_SET_PAYLOAD_LEN,
  ADDR_BREAK_SLOT_COUNT,
  RESPONSE_CODE,
};
