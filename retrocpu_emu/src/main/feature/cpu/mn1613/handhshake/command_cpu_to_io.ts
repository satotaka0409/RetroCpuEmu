/**
 * CPU → I/O ボード方向コマンド（I/O ボード側）
 *
 * HandShake.mdc「### レトロCPUボード -> 制御・I/Oボード」。
 * フレーム構築・線上の送受信は CPU ボードのアセンブラ
 * （retrocpu_boot_monitor/mn1613/src/handshake/）が行う。
 *
 * I/O ボード側は受信フレームを CpuToIoCommandDispatcher.dispatch() し、
 * IoControlHandshake.send() で応答を返す。
 *
 * ■ 受信フロー例
 *   const frame = await io.receiveFramed(
 *     (cmd) => CPU_PAYLOAD_REMAINING_SIZE[cmd] ?? 0,
 *   );
 *   const response = dispatcher.dispatch(frame);
 *   await io.send(response);
 *
 * ■ フレームバイトレイアウト（位置は HandShake.mdc の位置列に準拠）
 *   SP / STR / OSR2 は仕様上 3 バイト（24bit）扱い。
 *   BEEP / タイマーの位置列は仕様書にずれがあるため、本実装では
 *   データ長の説明（16bit 指定）を優先し cmd+2+2 = 5 バイトとした。
 */

import { CpuRegisters, reg16, reg24 } from "../mn1613registers";
export type { CpuRegisters };
export { reg16, reg24 };
import { CMD_CPU_TO_IO, MODE, RESPONSE_CODE } from "./handshake_type";

// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

/** LEDディスプレイデータ（HandShake.mdc LED表示依頼 0x16） */
export interface LedDisplayData {
  /**
   * 7セグメントLED 0〜11番のビットパターン (length=12)
   * 左から ADDR 8桁 + DATA 4桁。
   * ビット位置: [0,1,2,3,4,5,6,7] → 点灯位置: [a,b,c,d,e,f,g,dp]
   */
  sevenSeg: Uint8Array;
  /** 砲弾LED 0〜7番 ON/OFF (各Bit、1バイト) */
  bulletLed0_7: number;
  /** 砲弾LED 8〜F番 ON/OFF (各Bit、1バイト) */
  bulletLed8_F: number;
}

export const LED_SEVEN_SEG_COUNT = 12;

/** BEEP音パラメータ */
export interface BeepParams {
  /** 周波数 (Hz)。0 で停止 */
  frequencyHz: number;
  /** 鳴動時間 (ms)。0 で無限 */
  durationMs: number;
}

/** タイマー設定パラメータ */
export interface TimerParams {
  /** タイマー番号 (0 または 1)。割り込み要因もこの番号になる */
  timerNo: number;
  /** タイマー周期 (ms)。0 で停止 */
  periodMs: number;
  /** 割り込み回数。0 で無限 */
  count: number;
}

// ─────────────────────────────────────────────
// コールバック（I/Oボード実装側が提供する）
// ─────────────────────────────────────────────

/**
 * I/Oボード実装側が提供するコマンドハンドラ群。
 * 各メソッドは RESPONSE_CODE の値（OK=0x00 / NG=0x01 / 0x02）を返す。
 */
export interface CpuToIoHandlers {
  /** CPU状態通知 (cmd=0x10): CPUレジスタ状態を受け取る */
  onCpuStatusNotify(regs: CpuRegisters): number;

  /** モード設定 (cmd=0x11): 0=モニター / 1=フリー */
  onModeSet(mode: number): number;

  /**
   * 16進キー入力取得 (cmd=0x14): フリーモード時のみ有効。
   * columns: 列0〜7のキー状態（各バイトの各Bitが1=ON）
   */
  getHexKeys(): { columns: Uint8Array; status: number };

  /**
   * PCキー入力取得 (cmd=0x15): PCのキー入力を中継する。
   * ascii: ASCIIコード値 / keyCode: キーコード値
   */
  getPcKey(): { ascii: number; keyCode: number; status: number };

  /** LED表示依頼 (cmd=0x16): フリーモード／ユーザープログラム用。モニタは使わない */
  onLedDisplay(data: LedDisplayData): number;

  /**
   * BEEP音 (cmd=0x18): モード問わず使用可。
   * frequencyHz=0 で停止、durationMs=0 で無限
   */
  onBeep(params: BeepParams): number;

  /**
   * タイマー設定 (cmd=0x19): タイマー割り込み周期を設定。
   * timerNo=0/1 でタイマーを選ぶ。periodMs=0 で停止、count=0 で無限
   */
  onTimerSet(params: TimerParams): number;
  /**
   * アドレスブレイク番号取得 (cmd=0x1a):
   * 直近のブレイク番号(0-3)と発生時刻(64bit タイマー)を返す。
   * timestamp: Uint8Array(8) で上位バイトから順に[7..0]。
   */
  getAddrBreakInfo(): {
    breakNo: number;
    timestamp: Uint8Array;
    status: number;
  };
}

// ─────────────────────────────────────────────
// CPUが送信するフレームの総バイト数
// ─────────────────────────────────────────────

/**
 * 各コマンドに対して CPU が送信するフレームの総バイト数
 * （コマンドバイト + ペイロードバイトの合計）。
 */
export const CPU_FRAME_SIZE: Readonly<Record<number, number>> = {
  /** CPU状態通知: cmd(1) + レジスタ群(0x28) = 41バイト */
  [CMD_CPU_TO_IO.CPU_STATUS_NOTIFY]: 0x29,
  /** モード設定: cmd(1) + mode(1) = 2バイト */
  [CMD_CPU_TO_IO.MODE_SET]: 2,
  /** 16進キー入力取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.HEX_KEY_GET]: 1,
  /** PCキー入力取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.PC_KEY_GET]: 1,
  /** LED表示依頼: cmd(1) + 7seg×12(12) + 砲弾LED×2(2) = 15バイト */
  [CMD_CPU_TO_IO.LED_DISPLAY]: 15,
  /** BEEP音: cmd(1) + 周波数(2) + 長さ(2) = 5バイト */
  [CMD_CPU_TO_IO.BEEP]: 5,
  /** タイマー設定: cmd(1) + タイマー番号(1) + 周期(2) + 回数(2) = 6バイト */
  [CMD_CPU_TO_IO.TIMER_SET]: 6,
  /** アドレスブレイク番号取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.ADDR_BREAK_GET]: 1,
};

/**
 * I/Oボードがコマンドバイト(1byte)を受信した後に、
 * さらに追加で受信すべきバイト数（ペイロード残余サイズ）。
 * IoControlHandshake.receive() の length 引数として使用する。
 */
export const CPU_PAYLOAD_REMAINING_SIZE: Readonly<Record<number, number>> = {
  [CMD_CPU_TO_IO.CPU_STATUS_NOTIFY]:
    CPU_FRAME_SIZE[CMD_CPU_TO_IO.CPU_STATUS_NOTIFY] - 1,
  [CMD_CPU_TO_IO.MODE_SET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.MODE_SET] - 1,
  [CMD_CPU_TO_IO.HEX_KEY_GET]: 0,
  [CMD_CPU_TO_IO.PC_KEY_GET]: 0,
  [CMD_CPU_TO_IO.LED_DISPLAY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LED_DISPLAY] - 1,
  [CMD_CPU_TO_IO.BEEP]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.BEEP] - 1,
  [CMD_CPU_TO_IO.TIMER_SET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIMER_SET] - 1,
  [CMD_CPU_TO_IO.ADDR_BREAK_GET]: 0,
};

// ─────────────────────────────────────────────
// CPU状態通知フレーム バイトオフセット定数
// ─────────────────────────────────────────────

/** CPU状態通知フレーム内の各フィールドのバイトオフセット */
const OFS = {
  R0: 0x01, // 2バイト: R0 H,L
  R1: 0x03, // 2バイト
  R2: 0x05,
  R3: 0x07,
  R4: 0x09,
  SP: 0x0b, // 3バイト: 仕様上0x0E-0x0Bの3バイト
  STR: 0x0e, // 3バイト: 仕様上0x11-0x0Eの3バイト
  IC: 0x11, // 2バイト
  CSBR: 0x13,
  SSBR: 0x15,
  TSR0: 0x17,
  TSR1: 0x19,
  OSR0: 0x1b,
  OSR1: 0x1d, // 1バイト: 仕様上0x1E-0x1Dの1バイト
  OSR2: 0x1e, // 3バイト: 仕様上0x21-0x1Eの3バイト
  NPP_WORD: 0x21, // 2バイト: [0x21]=NPP, [0x22]=0x00
  IISR_WORD: 0x23, // 2バイト: [0x23]=0x00, [0x24]=IISR
  SBRB_WORD: 0x25, // 2バイト: [0x25]=0x00, [0x26]=SBRB
  ICB: 0x27, // 2バイト
} as const;

// ─────────────────────────────────────────────
// バイト入出力ユーティリティ（内部使用）
// ─────────────────────────────────────────────

/**
 * ビッグエンディアン 2 バイトを読む。
 * @param buf フレームバッファ
 * @param ofs 先頭からのバイトオフセット
 * @returns 16bit 値
 */
function read16(buf: Uint8Array, ofs: number): number {
  return ((buf[ofs] & 0xff) << 8) | (buf[ofs + 1] & 0xff);
}

/**
 * ビッグエンディアン 3 バイトを読む。
 * @param buf フレームバッファ
 * @param ofs 先頭からのバイトオフセット
 * @returns 24bit 値
 */
function read24(buf: Uint8Array, ofs: number): number {
  return (
    ((buf[ofs] & 0xff) << 16) |
    ((buf[ofs + 1] & 0xff) << 8) |
    (buf[ofs + 2] & 0xff)
  );
}

// ─────────────────────────────────────────────
// フレーム解析（I/Oボード側で使用）
// ─────────────────────────────────────────────

/**
 * CPU状態通知フレーム（cmd=0x10）からレジスタ値を取り出す。
 * オフセットは HandShake.mdc の位置表（欠番含む）に合わせている。
 * @param frame コマンドバイトを含む受信フレーム
 * @returns 各レジスタ値
 */
function parseCpuStatusFrame(frame: Uint8Array): CpuRegisters {
  return {
    R0: reg16(read16(frame, OFS.R0)),
    R1: reg16(read16(frame, OFS.R1)),
    R2: reg16(read16(frame, OFS.R2)),
    R3: reg16(read16(frame, OFS.R3)),
    R4: reg16(read16(frame, OFS.R4)),
    SP: reg24(read24(frame, OFS.SP)),
    STR: reg24(read24(frame, OFS.STR)),
    IC: reg16(read16(frame, OFS.IC)),
    CSBR: reg16(read16(frame, OFS.CSBR)),
    SSBR: reg16(read16(frame, OFS.SSBR)),
    TSR0: reg16(read16(frame, OFS.TSR0)),
    TSR1: reg16(read16(frame, OFS.TSR1)),
    OSR0: reg16(read16(frame, OFS.OSR0)),
    OSR1: reg16(frame[OFS.OSR1] & 0xff),
    OSR2: reg24(read24(frame, OFS.OSR2)),
    NPP: reg16(frame[OFS.NPP_WORD] & 0xff), // 上位バイト
    IISR: reg16(frame[OFS.IISR_WORD + 1] & 0xff), // 下位バイト
    SBRB: reg16(frame[OFS.SBRB_WORD + 1] & 0xff), // 下位バイト
    ICB: reg16(read16(frame, OFS.ICB)),
  };
}

// ─────────────────────────────────────────────
// I/Oボード側コマンドディスパッチャ
// ─────────────────────────────────────────────

/**
 * I/Oボード側の CPU -> I/O コマンドディスパッチャ。
 *
 * IoControlHandshake で受信したフレームを dispatch() に渡すと
 * 対応ハンドラを呼び出し、CPU に返すべき応答フレームを返す。
 *
 * @example
 * const dispatcher = new CpuToIoCommandDispatcher(handlers);
 * const frame = await io.receiveFramed(
 *   (cmd) => CPU_PAYLOAD_REMAINING_SIZE[cmd] ?? 0,
 * );
 * const response = dispatcher.dispatch(frame);
 * await io.send(response);
 */
export class CpuToIoCommandDispatcher {
  /**
   * @param handlers コマンドごとの処理を実装したハンドラ集合
   */
  constructor(private readonly handlers: CpuToIoHandlers) {}

  /**
   * 受信フレームを解析してハンドラを呼び出し、応答フレームを返す。
   * @param frame コマンドバイト + ペイロードの完全なフレーム
   */
  dispatch(frame: Uint8Array): Uint8Array {
    if (frame.length === 0) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }

    const cmd = frame[0];
    const expectedSize = CPU_FRAME_SIZE[cmd];
    if (expectedSize !== undefined && frame.length < expectedSize) {
      // フレームが短すぎる場合は NG を返す
      return new Uint8Array([RESPONSE_CODE.NG]);
    }

    switch (cmd) {
      case CMD_CPU_TO_IO.CPU_STATUS_NOTIFY:
        return this._handleCpuStatusNotify(frame);
      case CMD_CPU_TO_IO.MODE_SET:
        return this._handleModeSet(frame);
      case CMD_CPU_TO_IO.HEX_KEY_GET:
        return this._handleHexKeyGet();
      case CMD_CPU_TO_IO.PC_KEY_GET:
        return this._handlePcKeyGet();
      case CMD_CPU_TO_IO.LED_DISPLAY:
        return this._handleLedDisplay(frame);
      case CMD_CPU_TO_IO.BEEP:
        return this._handleBeep(frame);
      case CMD_CPU_TO_IO.TIMER_SET:
        return this._handleTimerSet(frame);
      case CMD_CPU_TO_IO.ADDR_BREAK_GET:
        return this._handleAddrBreakGet();
      default:
        return new Uint8Array([RESPONSE_CODE.NG]);
    }
  }

  // ── 各コマンドハンドラ ──────────────────────────────────────────────

  /**
   * CPU状態通知 (0x10)
   * CPU からレジスタ状態を受け取って onCpuStatusNotify を呼ぶ。
   * 応答: 1バイト (OK / NG)
   */
  private _handleCpuStatusNotify(frame: Uint8Array): Uint8Array {
    const regs = parseCpuStatusFrame(frame);
    const result = this.handlers.onCpuStatusNotify(regs);
    return new Uint8Array([result]);
  }

  /**
   * モード設定 (0x11)
   * 有効値は MODE.MONITOR(0) / MODE.FREE(1)。
   * 応答: 1バイト (OK / NG)
   */
  private _handleModeSet(frame: Uint8Array): Uint8Array {
    const mode = frame[0x01];
    if (mode !== MODE.MONITOR && mode !== MODE.FREE) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }
    const result = this.handlers.onModeSet(mode);
    return new Uint8Array([result]);
  }

  /**
   * 16進キー入力取得 (0x14)
   * フリーモード時のみ有効。
   * 応答: 9バイト = 列0〜7のキー状態(8) + ステータス(1)
   */
  private _handleHexKeyGet(): Uint8Array {
    const { columns, status } = this.handlers.getHexKeys();
    const response = new Uint8Array(9);
    // 列数が不足している場合は 0x00 で埋める
    const src =
      columns.length >= 8
        ? columns
        : (() => {
            const padded = new Uint8Array(8);
            padded.set(columns.slice(0, 8));
            return padded;
          })();
    response.set(src.slice(0, 8), 0);
    response[8] = status;
    return response;
  }

  /**
   * PCキー入力取得 (0x15)
   * 応答: 3バイト = ASCII値(1) + キーコード値(1) + ステータス(1)
   */
  private _handlePcKeyGet(): Uint8Array {
    const { ascii, keyCode, status } = this.handlers.getPcKey();
    return new Uint8Array([ascii & 0xff, keyCode & 0xff, status]);
  }

  /**
   * LED表示依頼 (0x16)
   * フリーモード時のみ有効。
   * 応答: 1バイト (OK / NG モードエラー / NG その他)
   */
  private _handleLedDisplay(frame: Uint8Array): Uint8Array {
    const data: LedDisplayData = {
      sevenSeg: frame.slice(0x01, 0x0d), // 0x01〜0x0C: 12バイト
      bulletLed0_7: frame[0x0d]!,
      bulletLed8_F: frame[0x0e]!,
    };
    const result = this.handlers.onLedDisplay(data);
    return new Uint8Array([result]);
  }

  /**
   * BEEP音 (0x18)
   * モード問わず使用可。
   * 応答: 1バイト (OK / NG)
   */
  private _handleBeep(frame: Uint8Array): Uint8Array {
    const params: BeepParams = {
      frequencyHz: read16(frame, 0x01),
      durationMs: read16(frame, 0x03),
    };
    const result = this.handlers.onBeep(params);
    return new Uint8Array([result]);
  }

  /**
   * タイマー設定 (0x19)
   * タイマー番号は 0 / 1 のみ有効。
   * 応答: 1バイト (OK / NG)
   */
  private _handleTimerSet(frame: Uint8Array): Uint8Array {
    const timerNo = frame[0x01]!;
    if (timerNo !== 0 && timerNo !== 1) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }
    const params: TimerParams = {
      timerNo,
      periodMs: read16(frame, 0x02),
      count: read16(frame, 0x04),
    };
    const result = this.handlers.onTimerSet(params);
    return new Uint8Array([result]);
  }

  /**
   * アドレスブレイク番号取得 (0x1a)
   * 応答: 10バイト = ブレイク番号(1) + 時刻バイト[7..0](8) + ステータス(1)
   */
  private _handleAddrBreakGet(): Uint8Array {
    const { breakNo, timestamp, status } = this.handlers.getAddrBreakInfo();
    const response = new Uint8Array(10);
    response[0] = breakNo & 0x03; // ブレイク番号 (0-3)
    // 64bit タイマー: バイト7(MSB)〜バイト0(LSB)
    const ts =
      timestamp.length >= 8
        ? timestamp
        : (() => {
            const padded = new Uint8Array(8);
            padded.set(timestamp.slice(0, timestamp.length));
            return padded;
          })();
    response.set(ts.slice(0, 8), 1); // response[1..8]
    response[9] = status;
    return response;
  }
}
