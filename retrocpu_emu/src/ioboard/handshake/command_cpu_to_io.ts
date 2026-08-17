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
 */

import {
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../shared/handshake/handshake_type";

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
  /** タイマー番号 (0 のみ)。割り込み要因は INT2_CAUSE=タイマー */
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
  /** モード設定 (cmd=0x10): 0=モニター / 1=フリー */
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
   * BEEP音 (cmd=0x19): モード問わず使用可。
   * frequencyHz=0 で停止、durationMs=0 で無限
   */
  onBeep(params: BeepParams): number;

  /**
   * タイマー設定 (cmd=0x12): タイマー割り込み周期を設定。
   * timerNo=0 のみ有効。periodMs=0 で停止、count=0 で無限
   */
  onTimerSet(params: TimerParams): number;
  /**
   * 時刻取得 (cmd=0x11):
   * 64bit タイマーを上位バイトから順に [7..0] で返す。
   */
  getTime(): { timestamp: Uint8Array; status: number };

  /**
   * 未定義命令LED (cmd=0x13): 砲弾 B (UNDEF) の点灯/消灯。
   * on=true で点灯、false で消灯。モード不問。
   */
  onUndefLed(on: boolean): number;

  /**
   * ブレイク通知 (cmd=0x1A): 比較器ヒットで CPU がモニタへ戻るとき。
   * HandShake.mdc の 1Ah ヘッダをそのまま渡す。
   */
  onBreakNotify(info: {
    /** 互換用: flags から導いた区分（0=命令 / 1=MEM / 2=IO） */
    kind: number;
    slot: number;
    /** 10h 表の flags（Bit0=IO, Bit1=RD, Bit2=WR, Bit3-5=条件, Bit7=履歴） */
    flags: number;
    /** 10h 表の count（ブレイクまでのカウント値） */
    breakCount: number;
    /** 履歴件数（0-16） */
    historyCount: number;
    addr: number;
  }): number;

  /**
   * ステップ通知 (cmd=0x1B): 1 命令実行後。addr はレベル2 IC 退避（バイト相当の 32bit）。
   * レジスタは 16bit。stack は SP+1 から 16 ワード。
   */
  onStepNotify(info: {
    addr: number;
    r0: number;
    r1: number;
    r2: number;
    r3: number;
    r4: number;
    sp: number;
    str: number;
    ic: number;
    csbrSsbr: number;
    tsr: number;
    npp: number;
    stack: number[];
  }): number;

  /**
   * LCD制御 (cmd=0x17): Clear/Home/DisplayCtrl/SetCursor。モード不問。
   * @param frame コマンドを含む 5 バイト
   */
  onLcdControl(frame: Uint8Array): number;

  /**
   * LCD文字列表示 (cmd=0x18): 行・列・長さ・ASCII。モード不問。
   * @param frame コマンドを含む 20 バイト
   */
  onLcdText(frame: Uint8Array): number;
}

// ─────────────────────────────────────────────
// CPUが送信するフレームの総バイト数
// ─────────────────────────────────────────────

/**
 * 各コマンドに対して CPU が送信するフレームの総バイト数
 * （コマンドバイト + ペイロードバイトの合計）。
 */
export const CPU_FRAME_SIZE: Readonly<Record<number, number>> = {
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
  /** 時刻取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.TIME_GET]: 1,
  /** 未定義命令LED: cmd(1) + Bit0(1) = 2バイト */
  [CMD_CPU_TO_IO.UNDEF_LED]: 2,
  /** ブレイク通知: cmd(1)+slot(1)+件数(1)+flags(1)+count(1)+addr32(4)+件数(1)+pad(1)=11バイト */
  [CMD_CPU_TO_IO.BREAK_NOTIFY]: 11,
  /** LCD制御: cmd(1) + kind(1) + argA(1) + argB(1) + argC(1) = 5バイト */
  [CMD_CPU_TO_IO.LCD_CTRL]: 5,
  /** LCD文字列表示: cmd(1) + row(1) + col(1) + len(1) + text16(16) = 20バイト */
  [CMD_CPU_TO_IO.LCD_TEXT]: 20,
  /** ステップ通知: cmd(1) + addr32(4) + レジスタ 22B + スタック 32B = 59バイト */
  [CMD_CPU_TO_IO.STEP_NOTIFY]: 59,
};

/**
 * I/Oボードがコマンドバイト(1byte)を受信した後に、
 * さらに追加で受信すべきバイト数（ペイロード残余サイズ）。
 * IoControlHandshake.receive() の length 引数として使用する。
 */
export const CPU_PAYLOAD_REMAINING_SIZE: Readonly<Record<number, number>> = {
  [CMD_CPU_TO_IO.MODE_SET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.MODE_SET] - 1,
  [CMD_CPU_TO_IO.HEX_KEY_GET]: 0,
  [CMD_CPU_TO_IO.PC_KEY_GET]: 0,
  [CMD_CPU_TO_IO.LED_DISPLAY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LED_DISPLAY] - 1,
  [CMD_CPU_TO_IO.BEEP]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.BEEP] - 1,
  [CMD_CPU_TO_IO.TIMER_SET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIMER_SET] - 1,
  [CMD_CPU_TO_IO.TIME_GET]: 0,
  [CMD_CPU_TO_IO.UNDEF_LED]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.UNDEF_LED] - 1,
  [CMD_CPU_TO_IO.BREAK_NOTIFY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.BREAK_NOTIFY] - 1,
  [CMD_CPU_TO_IO.LCD_CTRL]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LCD_CTRL] - 1,
  [CMD_CPU_TO_IO.LCD_TEXT]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LCD_TEXT] - 1,
  [CMD_CPU_TO_IO.STEP_NOTIFY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.STEP_NOTIFY] - 1,
};

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
   * @returns 応答フレーム（最小 1 バイト: OK/NG 系コード）
   */
  dispatch(frame: Uint8Array): Uint8Array {
    if (frame.length === 0) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }

    const cmd = frame[0];
    // 知っているコマンドは最小フレーム長を先に検査する。
    const expectedSize = CPU_FRAME_SIZE[cmd];
    if (expectedSize !== undefined && frame.length < expectedSize) {
      // フレームが短すぎる場合は NG を返す
      return new Uint8Array([RESPONSE_CODE.NG]);
    }

    switch (cmd) {
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
      case CMD_CPU_TO_IO.TIME_GET:
        return this._handleTimeGet();
      case CMD_CPU_TO_IO.UNDEF_LED:
        return this._handleUndefLed(frame);
      case CMD_CPU_TO_IO.BREAK_NOTIFY:
        return this._handleBreakNotify(frame);
      case CMD_CPU_TO_IO.LCD_CTRL:
        return this._handleLcdControl(frame);
      case CMD_CPU_TO_IO.LCD_TEXT:
        return this._handleLcdText(frame);
      case CMD_CPU_TO_IO.STEP_NOTIFY:
        return this._handleStepNotify(frame);
      default:
        // 未対応コマンドは仕様通り NG を返す。
        return new Uint8Array([RESPONSE_CODE.NG]);
    }
  }

  // ── 各コマンドハンドラ ──────────────────────────────────────────────

  /**
   * モード設定 (0x10)
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
   * BEEP音 (0x19)
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
   * タイマー設定 (0x12)
   * タイマー番号は 0 のみ有効（1 以上は NG）。
   * 応答: 1バイト (OK / NG)
   */
  private _handleTimerSet(frame: Uint8Array): Uint8Array {
    const timerNo = frame[0x01]!;
    if (timerNo !== 0) {
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
   * 時刻取得 (0x11)
   * 応答: 9バイト = 時刻バイト[7..0](8) + ステータス(1)
   */
  private _handleTimeGet(): Uint8Array {
    const { timestamp, status } = this.handlers.getTime();
    const response = new Uint8Array(9);
    const ts =
      timestamp.length >= 8
        ? timestamp
        : (() => {
            const padded = new Uint8Array(8);
            padded.set(timestamp.slice(0, timestamp.length));
            return padded;
          })();
    response.set(ts.slice(0, 8), 0);
    response[8] = status;
    return response;
  }

  /**
   * 未定義命令LED (0x13)
   * Bit0=0 消灯 / Bit0=1 点灯。それ以外の値は NG。
   * 応答: 1バイト (OK / NG)
   */
  private _handleUndefLed(frame: Uint8Array): Uint8Array {
    const flag = frame[0x01]!;
    if (flag !== 0 && flag !== 1) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }
    const result = this.handlers.onUndefLed(flag === 1);
    return new Uint8Array([result]);
  }

  /**
   * ブレイク通知 (0x1A)
   * スロット 0–7。応答: 1バイト (OK / NG)
   */
  private _handleBreakNotify(frame: Uint8Array): Uint8Array {
    const slot = frame[0x01]! & 0xff;
    if (slot > 7) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }
    const historyCount = frame[0x02]! & 0xff;
    const flags = frame[0x03]! & 0xff;
    const breakCount = frame[0x04]! & 0xff;
    const addr =
      ((frame[0x05]! & 0xff) << 24) |
      ((frame[0x06]! & 0xff) << 16) |
      ((frame[0x07]! & 0xff) << 8) |
      (frame[0x08]! & 0xff);
    const kind = (flags & 0x40) !== 0 ? 0 : (flags & 0x01) !== 0 ? 2 : 1;
    const result = this.handlers.onBreakNotify({
      kind,
      slot,
      flags,
      breakCount,
      historyCount,
      addr,
    });
    return new Uint8Array([result & 0xff]);
  }

  /**
   * ステップ通知 (0x1B)
   * 応答: 1バイト (OK / NG)
   */
  private _handleStepNotify(frame: Uint8Array): Uint8Array {
    const addr =
      ((frame[0x01]! & 0xff) << 24) |
      ((frame[0x02]! & 0xff) << 16) |
      ((frame[0x03]! & 0xff) << 8) |
      (frame[0x04]! & 0xff);
    const stack: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      stack.push(read16(frame, 0x1b + i * 2));
    }
    const result = this.handlers.onStepNotify({
      addr,
      r0: read16(frame, 0x05),
      r1: read16(frame, 0x07),
      r2: read16(frame, 0x09),
      r3: read16(frame, 0x0b),
      r4: read16(frame, 0x0d),
      sp: read16(frame, 0x0f),
      str: read16(frame, 0x11),
      ic: read16(frame, 0x13),
      csbrSsbr: read16(frame, 0x15),
      tsr: read16(frame, 0x17),
      npp: frame[0x19]! & 0xff,
      stack,
    });
    return new Uint8Array([result & 0xff]);
  }

  /**
   * LCD制御 (0x17)
   * 応答: 1バイト (OK / NG)
   */
  private _handleLcdControl(frame: Uint8Array): Uint8Array {
    const result = this.handlers.onLcdControl(frame);
    return new Uint8Array([result & 0xff]);
  }

  /**
   * LCD文字列表示 (0x18)
   * 応答: 1バイト (OK / NG)
   */
  private _handleLcdText(frame: Uint8Array): Uint8Array {
    const result = this.handlers.onLcdText(frame);
    return new Uint8Array([result & 0xff]);
  }
}
