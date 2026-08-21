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
  ADDR_BREAK_SLOT_COUNT,
  CMD_CPU_TO_IO,
  MODE,
  RESPONSE_CODE,
} from "../../shared/handshake/handshake_type";

/** 1Ah ブレイク通知ヘッダ長（コマンド含む） */
export const BREAK_NOTIFY_HEADER_SIZE = 11;
/** 履歴 1 エントリ長（MN1613。HandShake.mdc） */
export const BREAK_HISTORY_ENTRY_SIZE_MN1613 = 66;
/** 履歴 1 エントリ長（TMS9995。HandShake.mdc） */
export const BREAK_HISTORY_ENTRY_SIZE_TMS9995 = 78;
/** ステップ/未定義通知フレーム長（MN1613） */
export const CPU_STATE_NOTIFY_FRAME_SIZE_MN1613 = 59;
/** ステップ/未定義通知フレーム長（TMS9995） */
export const CPU_STATE_NOTIFY_FRAME_SIZE_TMS9995 = 70;
/**
 * 履歴 1 エントリの既定バイト長（MN1613）。
 * CPU 種別依存の切替は `breakHistoryEntrySizeForCpu` / ディスパッチャ引数を使う。
 */
export const BREAK_HISTORY_ENTRY_SIZE = BREAK_HISTORY_ENTRY_SIZE_MN1613;
/** 履歴件数の上限 */
export const BREAK_HISTORY_MAX_COUNT = 4;

/** IO ボード設定の CPU 種類（setting_area.CPU_TYPE と同値） */
export const HSHK_CPU_TYPE = {
  MN1613: 1,
  TMS9995: 2,
} as const;

/**
 * CPU 種類に応じた履歴エントリ長（1Ah / 87h）を返す。
 * @param cpuType setting_area の cpuType（1=MN1613, 2=TMS9995）
 * @returns バイト長
 */
export function breakHistoryEntrySizeForCpu(cpuType: number): number {
  return cpuType === HSHK_CPU_TYPE.TMS9995
    ? BREAK_HISTORY_ENTRY_SIZE_TMS9995
    : BREAK_HISTORY_ENTRY_SIZE_MN1613;
}

/**
 * CPU 種別を考慮したコマンド総フレーム長を返す。
 */
function cpuFrameSizeForCpu(cmd: number, cpuType: number): number {
  if (cmd === CMD_CPU_TO_IO.STEP_NOTIFY || cmd === CMD_CPU_TO_IO.UNDEF_NOTIFY) {
    return cpuType === HSHK_CPU_TYPE.TMS9995
      ? CPU_STATE_NOTIFY_FRAME_SIZE_TMS9995
      : CPU_STATE_NOTIFY_FRAME_SIZE_MN1613;
  }
  return CPU_FRAME_SIZE[cmd] ?? 1;
}

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

/** ステップ通知／未定義命令通知の共通ペイロード（59バイトフレーム） */
export interface CpuStateNotifyInfo {
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
   * columns: 列0〜7のキー状態。Bit3–0 の配置は HandShake.mdc（列0=C 8 4 0）。
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
    /** 履歴件数（0-4） */
    historyCount: number;
    /** 履歴エントリ生バイト（1件 MN1613=66B / TMS9995=78B、87h と同一形式） */
    historyEntries: Uint8Array[];
    addr: number;
  }): number;

  /**
   * ステップ通知 (cmd=0x1B): 1 命令実行後。addr はレベル2 IC 退避（バイト相当の 32bit）。
   * レジスタは 16bit。stack は SP+1 から 16 ワード。
   */
  onStepNotify(info: CpuStateNotifyInfo): number;

  /**
   * 未定義命令実行通知 (cmd=0x13): 未定義命令実行時の状態通知。
   * レイアウトはステップ通知と同一（59バイト）。
   */
  onUndefNotify(info: CpuStateNotifyInfo): number;

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

  /**
   * RTC 生レジスタ取得 (cmd=0x1C): PCF8523 の時刻レジスタ 7 バイトをそのまま返す。
   * レジスタ順: seconds, minutes, hours, days, weekdays, months, years
   */
  getRtcRaw(): { regs: Uint8Array; status: number };

  /**
   * 温度センサー生レジスタ取得 (cmd=0x1D): MCP9808 Ambient Temperature (0x05)。
   * 16bit 値をビッグエンディアンで返す（ビット解釈は呼び出し側）。
   */
  getTempRaw(): { raw: number; status: number };

  /**
   * 光センサー生レジスタ取得 (cmd=0x1E): TCS34725 RGBC。
   * 各値は 16bit。読み出し値をそのまま返す。
   */
  getLightRaw(): {
    clear: number;
    red: number;
    green: number;
    blue: number;
    status: number;
  };

  /**
   * 距離センサー生レジスタ取得 (cmd=0x1F): VL53L1X。
   * rangeStatus は RESULT__RANGE_STATUS の下位 5bit を返す。
   */
  getDistanceRaw(): { distanceMm: number; rangeStatus: number; status: number };
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
  /** PCキー入力取得: cmd(1) + pad(1) = 2バイト */
  [CMD_CPU_TO_IO.PC_KEY_GET]: 2,
  /** LED表示依頼: cmd(1) + 7seg×12(12) + 砲弾LED×2(2) + pad(1) = 16バイト */
  [CMD_CPU_TO_IO.LED_DISPLAY]: 16,
  /** BEEP音: cmd(1) + 周波数(2) + 長さ(2) + pad(1) = 6バイト */
  [CMD_CPU_TO_IO.BEEP]: 6,
  /** タイマー設定: cmd(1) + タイマー番号(1) + 周期(2) + 回数(2) = 6バイト */
  [CMD_CPU_TO_IO.TIMER_SET]: 6,
  /** 時刻取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.TIME_GET]: 1,
  /** ブレイク通知: ヘッダ 11 バイト + 履歴エントリ×件数（最小 11 バイト。エントリ長は CPU 依存） */
  [CMD_CPU_TO_IO.BREAK_NOTIFY]: BREAK_NOTIFY_HEADER_SIZE,
  /** LCD制御: cmd(1) + pad(1) + kind(1) + argA(1) + argB(1) + argC(1) = 6バイト */
  [CMD_CPU_TO_IO.LCD_CTRL]: 6,
  /** LCD文字列表示: cmd(1) + row(1) + col(1) + len(1) + text16(16) = 20バイト */
  [CMD_CPU_TO_IO.LCD_TEXT]: 20,
  /** ステップ通知: 既定（MN1613）59B。TMS9995 は 70B。 */
  [CMD_CPU_TO_IO.STEP_NOTIFY]: CPU_STATE_NOTIFY_FRAME_SIZE_MN1613,
  /** 未定義命令実行通知: 既定（MN1613）59B。TMS9995 は 70B。 */
  [CMD_CPU_TO_IO.UNDEF_NOTIFY]: CPU_STATE_NOTIFY_FRAME_SIZE_MN1613,
  /** RTC 生レジスタ取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.RTC_GET_RAW]: 1,
  /** 温度生レジスタ取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.TEMP_GET_RAW]: 1,
  /** 光センサー生レジスタ取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.LIGHT_GET_RAW]: 1,
  /** 距離センサー生レジスタ取得: cmd(1)のみ */
  [CMD_CPU_TO_IO.DISTANCE_GET_RAW]: 1,
};

/**
 * I/Oボードがコマンドバイト(1byte)を受信した後に、
 * さらに追加で受信すべきバイト数（ペイロード残余サイズ）。
 * IoControlHandshake.receive() の length 引数として使用する。
 */
export const CPU_PAYLOAD_REMAINING_SIZE: Readonly<Record<number, number>> = {
  [CMD_CPU_TO_IO.MODE_SET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.MODE_SET] - 1,
  [CMD_CPU_TO_IO.HEX_KEY_GET]: 0,
  [CMD_CPU_TO_IO.PC_KEY_GET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.PC_KEY_GET] - 1,
  [CMD_CPU_TO_IO.LED_DISPLAY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LED_DISPLAY] - 1,
  [CMD_CPU_TO_IO.BEEP]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.BEEP] - 1,
  [CMD_CPU_TO_IO.TIMER_SET]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.TIMER_SET] - 1,
  [CMD_CPU_TO_IO.TIME_GET]: 0,
  [CMD_CPU_TO_IO.BREAK_NOTIFY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.BREAK_NOTIFY] - 1,
  [CMD_CPU_TO_IO.LCD_CTRL]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LCD_CTRL] - 1,
  [CMD_CPU_TO_IO.LCD_TEXT]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.LCD_TEXT] - 1,
  [CMD_CPU_TO_IO.STEP_NOTIFY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.STEP_NOTIFY] - 1,
  [CMD_CPU_TO_IO.UNDEF_NOTIFY]: CPU_FRAME_SIZE[CMD_CPU_TO_IO.UNDEF_NOTIFY] - 1,
  [CMD_CPU_TO_IO.RTC_GET_RAW]: 0,
  [CMD_CPU_TO_IO.TEMP_GET_RAW]: 0,
  [CMD_CPU_TO_IO.LIGHT_GET_RAW]: 0,
  [CMD_CPU_TO_IO.DISTANCE_GET_RAW]: 0,
};

/**
 * CPU→IO 受信フレーム（可変長含む）の残余バイト数を返す。
 * 返値は「現在の frameSoFar に対して、あと何バイト必要か」。
 * - BREAK_NOTIFY(1Ah): 件数(02h) が読めるまでヘッダ長で待ち、読めたら エントリ長×件数を加算
 * - それ以外: 固定長（未定義コマンドは 1 バイト）
 * @param frameSoFar これまでに受信したバイト列（先頭はコマンド）
 * @param entrySize 履歴 1 エントリ長（既定 MN1613=66。TMS9995 は 78）
 */
export function cpuToIoRemainingSize(
  frameSoFar: Uint8Array,
  entrySize: number = BREAK_HISTORY_ENTRY_SIZE_MN1613,
  cpuType: number = HSHK_CPU_TYPE.MN1613,
): number {
  if (frameSoFar.length === 0) return 0;
  const cmd = frameSoFar[0] & 0xff;
  if (cmd !== CMD_CPU_TO_IO.BREAK_NOTIFY) {
    const total = cpuFrameSizeForCpu(cmd, cpuType);
    return Math.max(0, total - frameSoFar.length);
  }

  const headerTotal = BREAK_NOTIFY_HEADER_SIZE;
  if (frameSoFar.length < 3) {
    return Math.max(0, headerTotal - frameSoFar.length);
  }

  const historyCount = frameSoFar[2] & 0xff;
  // 異常値はヘッダ分だけ受けて dispatcher 側で NG 判定する。
  if (historyCount > BREAK_HISTORY_MAX_COUNT) {
    return Math.max(0, headerTotal - frameSoFar.length);
  }
  const total = headerTotal + historyCount * entrySize;
  return Math.max(0, total - frameSoFar.length);
}

/**
 * 指定エントリ長で閉じた `cpuToIoRemainingSize` を返す（mock / adaptive 受信用）。
 * @param entrySize 履歴 1 エントリ長
 * @returns frameSoFar → 残余バイト数
 */
export function makeCpuToIoRemainingSize(
  entrySize: number,
  cpuType: number = HSHK_CPU_TYPE.MN1613,
): (frameSoFar: Uint8Array) => number {
  return (frameSoFar) => cpuToIoRemainingSize(frameSoFar, entrySize, cpuType);
}

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
  private historyEntrySize: number;
  private cpuType: number;

  /**
   * @param handlers コマンドごとの処理を実装したハンドラ集合
   * @param options.historyEntrySize 1Ah/87h 相当の履歴エントリ長（省略時 MN1613=66）
   * @param options.cpuType setting_area の cpuType（省略時 MN1613）
   */
  constructor(
    private readonly handlers: CpuToIoHandlers,
    options: { historyEntrySize?: number; cpuType?: number } = {},
  ) {
    this.historyEntrySize =
      options.historyEntrySize ?? BREAK_HISTORY_ENTRY_SIZE_MN1613;
    this.cpuType = options.cpuType ?? HSHK_CPU_TYPE.MN1613;
  }

  /**
   * CPU 種別を切り替える（13h/1Bh の最小フレーム長判定に使用）。
   */
  setCpuType(cpuType: number): void {
    this.cpuType = cpuType;
  }

  /**
   * 履歴エントリ長を切り替える（設定エリアの CPU 種類変更時など）。
   * @param entrySize バイト長（MN1613=66 / TMS9995=78）
   */
  setHistoryEntrySize(entrySize: number): void {
    this.historyEntrySize = entrySize;
  }

  /**
   * 現在の履歴エントリ長を返す。
   * @returns バイト長
   */
  getHistoryEntrySize(): number {
    return this.historyEntrySize;
  }

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
    const expectedSize = cpuFrameSizeForCpu(cmd, this.cpuType);
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
      case CMD_CPU_TO_IO.BREAK_NOTIFY:
        return this._handleBreakNotify(frame);
      case CMD_CPU_TO_IO.LCD_CTRL:
        return this._handleLcdControl(frame);
      case CMD_CPU_TO_IO.LCD_TEXT:
        return this._handleLcdText(frame);
      case CMD_CPU_TO_IO.STEP_NOTIFY:
        return this._handleStepNotify(frame);
      case CMD_CPU_TO_IO.UNDEF_NOTIFY:
        return this._handleUndefNotify(frame);
      case CMD_CPU_TO_IO.RTC_GET_RAW:
        return this._handleRtcGetRaw();
      case CMD_CPU_TO_IO.TEMP_GET_RAW:
        return this._handleTempGetRaw();
      case CMD_CPU_TO_IO.LIGHT_GET_RAW:
        return this._handleLightGetRaw();
      case CMD_CPU_TO_IO.DISTANCE_GET_RAW:
        return this._handleDistanceGetRaw();
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
   * フリーモードのときのみ有効。モニターは列 0 + NG_MODE_ERROR。
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
      // frame = [cmd, pad, sevenSeg(12), bullet0_7, bullet8_F]
      sevenSeg: frame.slice(0x02, 0x0e), // 0x02〜0x0D: 12バイト
      bulletLed0_7: frame[0x0e]!,
      bulletLed8_F: frame[0x0f]!,
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
   * ブレイク通知 (0x1A)
   * スロット 0–3。応答: 1バイト (OK / NG)
   */
  private _handleBreakNotify(frame: Uint8Array): Uint8Array {
    const slot = frame[0x01]! & 0xff;
    if (slot >= ADDR_BREAK_SLOT_COUNT) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }
    const historyCount = frame[0x02]! & 0xff;
    if (historyCount > BREAK_HISTORY_MAX_COUNT) {
      return new Uint8Array([RESPONSE_CODE.NG]);
    }
    const flags = frame[0x03]! & 0xff;
    const breakCount = frame[0x04]! & 0xff;
    const addr =
      ((frame[0x05]! & 0xff) << 24) |
      ((frame[0x06]! & 0xff) << 16) |
      ((frame[0x07]! & 0xff) << 8) |
      (frame[0x08]! & 0xff);
    const kind = (flags & 0x40) !== 0 ? 0 : (flags & 0x01) !== 0 ? 2 : 1;
    const entriesStart = BREAK_NOTIFY_HEADER_SIZE;
    const availableEntryBytes = Math.max(0, frame.length - entriesStart);
    const entrySize = this.historyEntrySize;
    const availableEntryCount = Math.floor(availableEntryBytes / entrySize);
    const parseCount = Math.min(historyCount, availableEntryCount);
    const historyEntries: Uint8Array[] = [];
    for (let i = 0; i < parseCount; i += 1) {
      const from = entriesStart + i * entrySize;
      const to = from + entrySize;
      historyEntries.push(frame.slice(from, to));
    }
    const result = this.handlers.onBreakNotify({
      kind,
      slot,
      flags,
      breakCount,
      historyCount,
      historyEntries,
      addr,
    });
    return new Uint8Array([result & 0xff]);
  }

  /**
   * ステップ通知 (0x1B)
   * 応答: 1バイト (OK / NG)
   */
  private _handleStepNotify(frame: Uint8Array): Uint8Array {
    const result = this.handlers.onStepNotify(
      this._decodeCpuStateNotifyInfo(frame),
    );
    return new Uint8Array([result & 0xff]);
  }

  /**
   * 未定義命令実行通知 (0x13)
   * 応答: 1バイト (OK / NG)
   */
  private _handleUndefNotify(frame: Uint8Array): Uint8Array {
    const result = this.handlers.onUndefNotify(
      this._decodeCpuStateNotifyInfo(frame),
    );
    return new Uint8Array([result & 0xff]);
  }

  /**
   * 59バイト通知フレーム（1Bh/13h 共通）を構造化データへ展開する。
   */
  private _decodeCpuStateNotifyInfo(frame: Uint8Array): CpuStateNotifyInfo {
    const addr =
      ((frame[0x01]! & 0xff) << 24) |
      ((frame[0x02]! & 0xff) << 16) |
      ((frame[0x03]! & 0xff) << 8) |
      (frame[0x04]! & 0xff);
    const stack: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      stack.push(read16(frame, 0x1b + i * 2));
    }
    return {
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
    };
  }

  /**
   * RTC 生レジスタ取得 (0x1C)
   * 応答: 8バイト = regs[7] + status
   */
  private _handleRtcGetRaw(): Uint8Array {
    const { regs, status } = this.handlers.getRtcRaw();
    const response = new Uint8Array(8);
    const src =
      regs.length >= 7
        ? regs
        : (() => {
            const padded = new Uint8Array(7);
            padded.set(regs.slice(0, regs.length));
            return padded;
          })();
    response.set(src.slice(0, 7), 0);
    response[7] = status & 0xff;
    return response;
  }

  /**
   * 温度センサー生レジスタ取得 (0x1D)
   * 応答: 3バイト = raw16(BE) + status
   */
  private _handleTempGetRaw(): Uint8Array {
    const { raw, status } = this.handlers.getTempRaw();
    return new Uint8Array([(raw >>> 8) & 0xff, raw & 0xff, status & 0xff]);
  }

  /**
   * 光センサー生レジスタ取得 (0x1E)
   * 応答: 9バイト = C,R,G,B 各 16bit(BE) + status
   */
  private _handleLightGetRaw(): Uint8Array {
    const { clear, red, green, blue, status } = this.handlers.getLightRaw();
    return new Uint8Array([
      (clear >>> 8) & 0xff,
      clear & 0xff,
      (red >>> 8) & 0xff,
      red & 0xff,
      (green >>> 8) & 0xff,
      green & 0xff,
      (blue >>> 8) & 0xff,
      blue & 0xff,
      status & 0xff,
    ]);
  }

  /**
   * 距離センサー生レジスタ取得 (0x1F)
   * 応答: 4バイト = distance16(BE) + rangeStatus + status
   */
  private _handleDistanceGetRaw(): Uint8Array {
    const { distanceMm, rangeStatus, status } = this.handlers.getDistanceRaw();
    return new Uint8Array([
      (distanceMm >>> 8) & 0xff,
      distanceMm & 0xff,
      rangeStatus & 0x1f,
      status & 0xff,
    ]);
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
