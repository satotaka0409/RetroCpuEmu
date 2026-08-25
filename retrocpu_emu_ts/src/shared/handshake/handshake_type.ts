/**
 * ハンドシェイク共通型定義
 *
 * レトロCPUボード・制御I/Oボードの両側で使用する
 * 信号線状態・割り込み制御・コマンド定数を定義する。
 */

import type { CpuIoSignals } from "../../cpuboard/mn1613/mn1613ioport";

/**
 * IN_REQ を立てても INT2 を起こさない印（CPU→IO の応答）。
 * BIOS は `g_hshk_wait_req1_1` でポーリングする。INT2 を上げると
 * ハンドシェイク IRQ が status バイトをコマンドとして奪い、LCD 18h などが進まない。
 */
export const HSHK_IN_REQ_NO_IRQ = Symbol("HSHK_IN_REQ_NO_IRQ");

/**
 * HSHK_IN_REQ をセットする。
 * @param bus ハンドシェイクバス
 * @param value 0 または 1
 * @param raiseIrq false なら INT2 を起こさない（CPU→IO 応答）
 */
export function setHshkInReq(
  bus: CpuIoSignals,
  value: 0 | 1,
  raiseIrq = true,
): void {
  const ext = bus as CpuIoSignals & { [HSHK_IN_REQ_NO_IRQ]?: boolean };
  ext[HSHK_IN_REQ_NO_IRQ] = !raiseIrq;
  try {
    bus.HSHK_IN_REQ = value;
  } finally {
    ext[HSHK_IN_REQ_NO_IRQ] = false;
  }
}

/** CpuIoSignals の初期値を生成する */
export function createHandshakeBus(): CpuIoSignals {
  const bus: CpuIoSignals & {
    HSHK_ENA?: 0 | 1;
    HSHK_REQ_0?: 0 | 1;
    HSHK_REQ_1?: 0 | 1;
  } = {
    INTERRUPT_BUSY: 0,
    INT_CAUSE: 0,
    HSHK_OUT_DENA: 0,
    HSHK_OUT_DACK: 0,
    HSHK_IN_DENA: 0,
    HSHK_IN_DACK: 0,
    HSHK_IN_DATA: 0,
    HSHK_OUT_DATA: 0,
    HSHK_OUT_REQ: 0,
    HSHK_IN_REQ: 0,
    CLK: 0,
  };

  // 旧テスト資産互換: REQ_0/REQ_1 を OUT_REQ/IN_REQ へ透過マップする。
  Object.defineProperties(bus, {
    HSHK_ENA: {
      configurable: true,
      enumerable: true,
      get() {
        return bus.HSHK_OUT_DENA;
      },
      set(v: number) {
        bus.HSHK_OUT_DENA = v ? 1 : 0;
      },
    },
    HSHK_REQ_0: {
      configurable: true,
      enumerable: true,
      get() {
        return bus.HSHK_OUT_REQ;
      },
      set(v: number) {
        bus.HSHK_OUT_REQ = v ? 1 : 0;
      },
    },
    HSHK_REQ_1: {
      configurable: true,
      enumerable: true,
      get() {
        return bus.HSHK_IN_REQ;
      },
      set(v: number) {
        bus.HSHK_IN_REQ = v ? 1 : 0;
      },
    },
  });

  return bus;
}

// ─────────────────────────────────────────────
// 割り込み要因（IO:0021）
// ─────────────────────────────────────────────

/** INT1 割り込み要因（Bit0）。レベル1＝ブレイク／ステップ */
export const INT1_CAUSE_CODE = {
  /** 比較器ヒット（アドレスブレイク） */
  ADDR_BREAK: 0,
  /** ステップ実行（CPLD ワンショット） */
  STEP: 1,
} as const;

/** INT2 割り込み要因（Bit1-2）。レベル2＝タイマー／ハンドシェイク */
export const INT2_CAUSE_CODE = {
  /** タイマー満了（00b → ポート値 0x00） */
  TIMER: 0,
  /** ハンドシェイク（01b → ポート値 0x02） */
  HANDSHAKE: 2,
} as const;

/**
 * IO:0021 に載せる INT2 要因値（Bit1-2 のみ有効）。
 * @param cause INT2_CAUSE_CODE.TIMER / HANDSHAKE
 * @returns 0x00 または 0x02
 */
export function encodeInt2Cause(
  cause: typeof INT2_CAUSE_CODE.TIMER | typeof INT2_CAUSE_CODE.HANDSHAKE,
): number {
  return cause & 0x06;
}

/**
 * IO:0021 に載せる INT1 要因値（Bit0 のみ有効）。
 * @param cause INT1_CAUSE_CODE.ADDR_BREAK / STEP
 * @returns 0x00 または 0x01
 */
export function encodeInt1Cause(
  cause: typeof INT1_CAUSE_CODE.ADDR_BREAK | typeof INT1_CAUSE_CODE.STEP,
): number {
  return cause & 0x01;
}

/** 後方互換エイリアス（INT_CAUSE 統合表記） */
export const INT_CAUSE_CODE = {
  TIMER: INT2_CAUSE_CODE.TIMER,
  HANDSHAKE: INT2_CAUSE_CODE.HANDSHAKE,
  ADDR_BREAK: INT1_CAUSE_CODE.ADDR_BREAK,
  STEP: INT1_CAUSE_CODE.STEP,
} as const;

/**
 * タイマー満了時の INT2 要因（IO:0021 Bit1-2=00）。
 * @returns 0x00
 */
export function intCauseForTimer(): typeof INT2_CAUSE_CODE.TIMER {
  return INT2_CAUSE_CODE.TIMER;
}

// ─────────────────────────────────────────────
// コマンド定数
// ─────────────────────────────────────────────

/** CPU -> I/O 方向コマンド（HandShake.mdc 概要表の順） */
export const CMD_CPU_TO_IO = {
  /** モニターモード/フリーモード設定 */
  MODE_SET: 0x10,
  /** 時刻取得（64bit タイマー、上位バイト先） */
  TIME_GET: 0x11,
  /** タイマー割り込み設定 */
  TIMER_SET: 0x12,
  /** 未定義命令実行通知（未定義命令実行時の状態通知） */
  UNDEF_NOTIFY: 0x13,
  /** 16進キー入力状態を取得（フリーモードのみ。モニターは NG） */
  HEX_KEY_GET: 0x14,
  /** PCのキー入力を中継してキー入力状態を取得 */
  PC_KEY_GET: 0x15,
  /** LED表示を指示（フリーモード／ユーザープログラム用。モニタは使わない） */
  LED_DISPLAY: 0x16,
  /** LCD1602 制御（Clear/Home/DisplayCtrl/SetCursor）。モード不問 */
  LCD_CTRL: 0x17,
  /** LCD1602 文字列表示。モード不問 */
  LCD_TEXT: 0x18,
  /** BEEP音を鳴らす */
  BEEP: 0x19,
  /** ブレイク通知（比較器ヒットで CPU が停止するとき） */
  BREAK_NOTIFY: 0x1a,
  /** ステップ通知（1 命令実行後の状態。比較器ヒットの 1Ah とは別） */
  STEP_NOTIFY: 0x1b,
  /** RTC 生レジスタ取得（PCF8523 の時刻レジスタ） */
  RTC_GET_RAW: 0x1c,
  /** 温度センサー生レジスタ取得（MCP9808 Ambient Temperature） */
  TEMP_GET_RAW: 0x1d,
  /** 光センサー生レジスタ取得（TCS34725 RGBC） */
  LIGHT_GET_RAW: 0x1e,
  /** 距離センサー生レジスタ取得（VL53L1X） */
  DISTANCE_GET_RAW: 0x1f,
} as const;

/** I/O -> CPU 方向コマンド（HandShake.mdc 概要表の順。TCP も同じ番号を使う） */
export const CMD_IO_TO_CPU = {
  /** 比較器ブレイク設定（命令／メモリ／IO、スロット 0–3） */
  BREAK_MEM_IO_SET: 0x80,
  /** 比較器ブレイク解除（スロット 0–3） */
  BREAK_MEM_IO_CLR: 0x81,
  /** アドレスを渡してプログラムを実行する */
  EXEC: 0x82,
  /** アドレスとバイト数を渡してメモリを読み込む */
  MEM_READ: 0x83,
  /** アドレスとバイト数、データを渡してメモリを書き込む */
  MEM_WRITE: 0x84,
  /** アドレスとバイト数を渡してIOを読み込む */
  IO_READ: 0x85,
  /** アドレスとバイト数、データを渡してIOを書き込む */
  IO_WRITE: 0x86,
  /** 履歴設定スロットの履歴を取得する */
  BREAK_HIST_GET: 0x87,
  /** ブレイクから復帰して実行する（0=通常 / 1=ステップ） */
  BREAK_RESUME: 0x88,
  /** TTY コンソール入力 */
  TTY_CONSOLE_INPUT: 0x89,
  /** 廃止（旧 INT3 命令パッチ。ディスパッチ範囲外） */
  BREAK_INST_SET: 0x42,
  /** 廃止（旧 INT3 命令パッチ。ディスパッチ範囲外） */
  BREAK_INST_CLR: 0x43,
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

/** アドレス／IO ブレイクスロット数（番号 0–3。比較器 4 本すべてユーザ） */
export const ADDR_BREAK_SLOT_COUNT = 4;

/** 80h のコマンド除くペイロード長（slot, flags, count, addr32, data16） */
export const ADDR_BREAK_SET_PAYLOAD_LEN = 9;

/** 80h の線上／TCP 全長（コマンド含む） */
export const ADDR_BREAK_SET_FRAME_LEN = 1 + ADDR_BREAK_SET_PAYLOAD_LEN;

/** 81h の線上／TCP 全長（コマンド＋スロット） */
export const ADDR_BREAK_CLR_FRAME_LEN = 2;

/** 83h メモリ読み出し要求（cmd + addr32 BE + count32 BE）。TCP／論理ヘッダ。線上は末尾にパッド 1B */
export const MEM_READ_REQ_FRAME_LEN = 9;

/** 84h メモリ書き込み要求ヘッダ（cmd + addr32 BE + count32 BE。続けて data）。TCP／論理。線上はパッド 1B のあと data */
export const MEM_WRITE_REQ_HEADER_LEN = 9;

/** 83h/84h 線上ヘッダ長（cmd + addr32 + count32 + パッド 0） */
export const MEM_RW_WIRE_HEADER_LEN = 10;

/** 15h/16h の最大転送バイト数 */
export const HSHK_IO_MAX_BYTES = 254;

/** TCP 83h/84h の 1 回あたり最大バイト数 */
export const DEBUG_MEM_MAX_BYTES = 65536;

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

/**
 * ブレイク条件（HandShake.mdc Bit3–5）。
 * 000=なし / 001:= / 010:<> / 011:>= / 100:<= / 101:AND<>0 / 110:AND=0
 */
export const BREAK_CONDITION = {
  NONE: 0b000,
  EQ: 0b001,
  NEQ: 0b010,
  GTE: 0b011,
  LTE: 0b100,
  AND_NE0: 0b101,
  AND_EQ0: 0b110,
} as const;

// ─────────────────────────────────────────────
// チェックサム・ブロック分割ユーティリティ
// ─────────────────────────────────────────────

/** メモリ R/W（83h/84h）のブロック長（HandShake.mdc。端数はパディングしない） */
export const HSHK_MEM_BLOCK = 256;

/** 83h/84h チェックサム不一致時の同一ブロック再送回数上限 */
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

// ─────────────────────────────────────────────
// 内部ユーティリティ（両ボード共通）
// ─────────────────────────────────────────────

export const DEFAULT_TIMEOUT_MS = 5000;

/** ACK=0 チェックの最大リトライ回数（HandShake.mdc: 最大10回 ≒ 1ms） */
export const ACK0_RETRY_MAX = 10;

/** ACK=0 チェック待機の下限 [us]（HandShake.mdc: 10us～30us） */
export const ACK0_DELAY_MIN_US = 10;

/** ACK=0 チェック待機の上限 [us] */
export const ACK0_DELAY_MAX_US = 30;

/**
 * 10us～30us のランダム待機（HandShake.mdc ACK=0 チェック用）。
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
 * HSHK_ENA==0 になるまで、10us～30us（ランダム）待機を最大 maxRetry 回繰り返す。
 * 既に 0 なら待たない。
 * @param isEna0 - ENA が 0 なら true を返す
 * @param maxRetry - 最大リトライ回数
 * @throws 超過時 Error
 */
export async function waitEna0Check(
  isEna0: () => boolean,
  maxRetry: number = ACK0_RETRY_MAX,
): Promise<void> {
  if (isEna0()) return;
  for (let i = 0; i < maxRetry; i += 1) {
    await delayAck0RandomUs();
    if (isEna0()) return;
  }
  throw new Error("handshake ENA0 check failed");
}

/** @deprecated 別名: waitEna0Check */
export const waitAck0Check = waitEna0Check;

/**
 * 信号待ち 1 ターンで CPU を進める上限。
 * 2 バイト DENA/DACK の片側は数十命令なので、この回数以内で揃えば setTimeout しない。
 */
export const WAIT_CONDITION_POLL_BUDGET = 4096;

/**
 * condition が true を返すまでポーリングで待機する。
 * @param condition 成立したら true
 * @param timeoutMs 上限ミリ秒
 * @param onPoll 1 回の確認で条件未成立のとき呼ぶ（同一スレッドの 1 命令 tick）
 * @throws timeoutMs を超えた場合に Error をスロー
 */
export function waitCondition(
  condition: () => boolean,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  onPoll?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const yieldTurn =
      typeof setImmediate === "function"
        ? (fn: () => void) => setImmediate(fn)
        : (fn: () => void) => setTimeout(fn, 0);
    /** 条件成立なら resolve、期限切れなら reject、それ以外は CPU を進めて yield */
    const check = (): void => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("handshake timeout"));
        return;
      }
      if (onPoll) {
        for (let i = 0; i < WAIT_CONDITION_POLL_BUDGET; i += 1) {
          onPoll();
          if (condition()) {
            resolve();
            return;
          }
        }
      }
      yieldTurn(check);
    };
    check();
  });
}
