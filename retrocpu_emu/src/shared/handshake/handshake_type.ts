/**
 * ハンドシェイク共通型定義
 *
 * レトロCPUボード・制御I/Oボードの両側で使用する
 * 信号線状態・割り込み制御・コマンド定数を定義する。
 */

import type { CpuIoSignals } from "../../cpuboard/mn1613/mn1613ioport";

/** CpuIoSignals の初期値を生成する */
export function createHandshakeBus(): CpuIoSignals {
  return {
    INTERRUPT_BUSY: 0,
    INT_CAUSE: 0,
    HSHK_ENA: 0,
    HSHK_DENA: 0,
    HSHK_DACK: 0,
    HSHK_IN_DATA: 0,
    HSHK_OUT_DATA: 0,
    HSHK_REQ_0: 0,
    HSHK_REQ_1: 0,
    CLK: 0,
  };
}

// ─────────────────────────────────────────────
// 割り込み要因
// ─────────────────────────────────────────────

export const INT_CAUSE_CODE = {
  /** タイマー0（ハンドシェイク 15h のタイマー番号 0） */
  TIMER0: 0,
  /** タイマー1（ハンドシェイク 15h のタイマー番号 1） */
  TIMER1: 1,
  /** ハンドシェイクによる割り込み */
  HANDSHAKE: 2,
  /** アドレスブレイク */
  ADDR_BREAK: 4,
} as const;

/**
 * タイマー番号に対応する割り込み要因を返す。
 * @param timerNo タイマー番号（0 または 1）
 * @returns INT_CAUSE_CODE.TIMER0 / TIMER1
 * @throws 0/1 以外を渡した場合
 */
export function intCauseForTimer(timerNo: number): 0 | 1 {
  if (timerNo === 0) return INT_CAUSE_CODE.TIMER0;
  if (timerNo === 1) return INT_CAUSE_CODE.TIMER1;
  throw new Error(`invalid timer number: ${timerNo}`);
}

// ─────────────────────────────────────────────
// コマンド定数
// ─────────────────────────────────────────────

/** CPU -> I/O 方向コマンド */
export const CMD_CPU_TO_IO = {
  /** モニターモード/フリーモード設定 */
  MODE_SET: 0x10,
  /** 16進キー入力状態を取得（フリーモード時） */
  HEX_KEY_GET: 0x11,
  /** PCのキー入力を中継してキー入力状態を取得 */
  PC_KEY_GET: 0x12,
  /** LED表示を指示（フリーモード／ユーザープログラム用。モニタは使わない） */
  LED_DISPLAY: 0x13,
  /** BEEP音を鳴らす */
  BEEP: 0x14,
  /** タイマー割り込み設定 */
  TIMER_SET: 0x15,
  /** 時刻取得（64bit タイマー、上位バイト先） */
  TIME_GET: 0x16,
  /** 未定義命令LED 点灯/消灯（Bit0: 0=消灯 / 1=点灯） */
  UNDEF_LED: 0x17,
  /** ブレイク通知（比較器ヒットで CPU が停止するとき） */
  BREAK_NOTIFY: 0x18,
  /** LCD1602 制御（Clear/Home/DisplayCtrl/SetCursor）。モード不問 */
  LCD_CTRL: 0x19,
  /** LCD1602 文字列表示。モード不問 */
  LCD_TEXT: 0x1a,
} as const;

/** I/O -> CPU 方向コマンド */
export const CMD_IO_TO_CPU = {
  /** メモリ/IOブレイクを設定する */
  BREAK_MEM_IO_SET: 0x40,
  /** メモリ/IOブレイクを解除する */
  BREAK_MEM_IO_CLR: 0x41,
  /** 命令ブレイクを設定する */
  BREAK_INST_SET: 0x42,
  /** 命令ブレイクを解除する */
  BREAK_INST_CLR: 0x43,
  /** CPUレジスタなどの状態を取得する */
  CPU_STATUS_GET: 0x48,
  /** アドレスを渡してプログラムを実行する */
  EXEC: 0x49,
  /** アドレスとバイト数を渡してメモリを読み込む */
  MEM_READ: 0x50,
  /** アドレスとバイト数、データを渡してメモリを書き込む */
  MEM_WRITE: 0x51,
  /** アドレスとバイト数を渡してIOを読み込む */
  IO_READ: 0x52,
  /** アドレスとバイト数、データを渡してIOを書き込む */
  IO_WRITE: 0x53,
} as const;

/** 応答コード */
export const RESPONSE_CODE = {
  OK: 0x00,
  NG: 0x01,
  NG_MODE_ERROR: 0x01,
  NG_OTHER_ERROR: 0x02,
} as const;

/** モード設定値 */
export const MODE = {
  MONITOR: 0,
  FREE: 1,
} as const;

// ─────────────────────────────────────────────
// ブレイク設定フラグ
// ─────────────────────────────────────────────

/** アドレス／IO ブレイクスロット数（番号 0–5） */
export const ADDR_BREAK_SLOT_COUNT = 6;

/** 40h のコマンド除くペイロード長（slot, flags, count, addr32, data16） */
export const ADDR_BREAK_SET_PAYLOAD_LEN = 9;

/** 40h の線上／TCP 全長（コマンド含む） */
export const ADDR_BREAK_SET_FRAME_LEN = 1 + ADDR_BREAK_SET_PAYLOAD_LEN;

/** 41h の線上／TCP 全長（コマンド＋スロット） */
export const ADDR_BREAK_CLR_FRAME_LEN = 2;

/** ブレイク対象 */
export const BREAK_TARGET = {
  MEM: 0,
  IO: 1,
} as const;

/** ブレイク方向 */
export const BREAK_DIRECTION = {
  READ: 0,
  WRITE: 1,
} as const;

/** ブレイク条件 (Bit2-4) */
export const BREAK_CONDITION = {
  EQ: 0b000,
  NEQ: 0b001,
  GTE: 0b010,
  LTE: 0b011,
  AND_MASK: 0b100,
} as const;

// ─────────────────────────────────────────────
// チェックサム・ブロック分割ユーティリティ
// ─────────────────────────────────────────────

/** メモリ R/W（50h/51h）のブロック長（HandShake.mdc。端数はパディングしない） */
export const HSHK_MEM_BLOCK = 256;

/** 50h/51h チェックサム不一致時の同一ブロック再送回数上限 */
export const HSHK_MEM_RETRY_MAX = 10;

/**
 * 32bit 値をビッグエンディアン 4 バイトにする。
 * @param n 符号なし 32bit
 * @returns [b24-31, b16-23, b8-15, b0-7]
 */
export function u32be(n: number): [number, number, number, number] {
  const v = n >>> 0;
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

/**
 * ブロック単位（デフォルト256バイト）のチェックサムを計算する。
 * チェックサムは各バイトの単純加算の下位8ビット。
 */
export function calcBlockChecksum(block: Uint8Array): number {
  let sum = 0;
  for (const b of block) {
    sum = (sum + b) & 0xff;
  }
  return sum;
}

/**
 * データを blockSize バイトのブロック列に分割する。
 * 端数はパディングなしでそのまま末尾ブロックとして返す。
 */
export function splitToBlocks(data: Uint8Array, blockSize = 256): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length; offset += blockSize) {
    blocks.push(data.slice(offset, offset + blockSize));
  }
  return blocks;
}

// ─────────────────────────────────────────────
// 内部ユーティリティ（両ボード共通）
// ─────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 5000;

/** ACK=0 チェックの最大リトライ回数（HandShake.mdc: 最大10回 ≒ 1ms） */
export const ACK0_RETRY_MAX = 10;

/** ACK=0 チェック待機の下限 [us] */
export const ACK0_DELAY_MIN_US = 50;

/** ACK=0 チェック待機の上限 [us] */
export const ACK0_DELAY_MAX_US = 100;

/**
 * 50us～100us のランダム待機（HandShake.mdc ACK=0 チェック用）。
 * エミュレータ上は実時間ではなく短い非同期 yield で近似する。
 */
export function delayAck0RandomUs(): Promise<void> {
  const span = ACK0_DELAY_MAX_US - ACK0_DELAY_MIN_US;
  const us = ACK0_DELAY_MIN_US + Math.floor(Math.random() * (span + 1));
  // Node の setTimeout は ms 粒度のため、us は仕様上の意味付けとして残し yield する
  void us;
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * HSHK_ENA==0 になるまで、50us～100us（ランダム）待機を最大 maxRetry 回繰り返す。
 * @param isEna0 - ENA が 0 なら true を返す
 * @param maxRetry - 最大リトライ回数
 * @throws 超過時 Error
 */
export async function waitEna0Check(
  isEna0: () => boolean,
  maxRetry: number = ACK0_RETRY_MAX,
): Promise<void> {
  for (let i = 0; i < maxRetry; i += 1) {
    await delayAck0RandomUs();
    if (isEna0()) return;
  }
  throw new Error("handshake ENA0 check failed");
}

/** @deprecated 別名: waitEna0Check */
export const waitAck0Check = waitEna0Check;

/**
 * condition が true を返すまでポーリングで待機する。
 * @throws timeoutMs を超えた場合に Error をスロー
 */
export function waitCondition(
  condition: () => boolean,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    /** 条件成立なら resolve、期限切れなら reject、それ以外は次のタスクで再試行 */
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("handshake timeout"));
        return;
      }
      setTimeout(check, 0);
    };
    check();
  });
}
