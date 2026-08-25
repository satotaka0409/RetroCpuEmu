/**
 * MN1613 ハンドシェイク相手（制御・I/O ボード）のモック
 * 根拠: HandShake.mdc / retrocpu_emu.mdc 2-1
 *
 * モニター（CPU 側アセンブラ）を retrocpu_emu 上で動かすとき、
 * 1階ボードの代わりに CPU→IO コマンドへ応答し、必要なら IO→CPU を起動する。
 */

import {
  setIoReadCallback,
  setIoWriteCallback,
  setPins,
  triggerInterrupt,
} from "../../cpuboard/mn1613/mn1613";
import type { CpuIoSignals } from "../../cpuboard/mn1613/mn1613ioport";
import {
  BREAK_HISTORY_ENTRY_SIZE_MN1613,
  breakHistoryEntrySizeForCpu,
  CpuToIoCommandDispatcher,
  makeCpuToIoRemainingSize,
  type BeepParams,
  type CpuStateNotifyInfo,
  type CpuToIoHandlers,
  type LedDisplayData,
  type TimerParams,
} from "./command_cpu_to_io";
import { IoControlHandshake } from "../../shared/handshake/handshake_ioboard";
import {
  CMD_IO_TO_CPU,
  createHandshakeBus,
  DEFAULT_TIMEOUT_MS,
  HSHK_IN_REQ_NO_IRQ,
  intCauseForTimer,
  MODE,
  RESPONSE_CODE,
  setHshkInReq,
  waitCondition,
} from "../../shared/handshake/handshake_type";
import { createHandshakeIoPortBridge } from "../../cpuboard/handshake/io_port_bridge";
import { panelKeyColumnMask } from "../hex_keyboard/key_matrix";
import { applyLedDisplayCommand } from "../seven_led/io_led";
import {
  applyUndefLedCommand,
  resetUndefLed,
} from "../bullet_led/io_undef_led";
import { lcdConsole, resetLcdConsole } from "../lcd_console";
import type { IoTimeSource } from "../timer/io_time";
import {
  IoTimer,
  type IoTimerHandle,
  type IoTimerScheduler,
} from "../timer/io_timer";

/** タイマー割り込みを配送できなかったときの再試行間隔 (ms) */
const TIMER_IRQ_RETRY_MS = 1;

export type IoBoardMockLogEntry = {
  at: number;
  dir: "cpu_to_io" | "io_to_cpu";
  cmd: number;
  frame: Uint8Array;
  response?: Uint8Array;
};

export type IoBoardMockState = {
  mode: number;
  led: LedDisplayData | null;
  hexKeys: Uint8Array;
  pcKey: { ascii: number; keyCode: number };
  lastBeep: BeepParams | null;
  lastTimer: TimerParams | null;
  /** 未定義命令LED（未定義命令通知で点灯）。true=点灯 */
  undefLed: boolean;
  addrBreakNo: number;
  /** 直近のブレイク通知（1Ah）。未受信は null */
  lastBreakNotify: {
    kind: number;
    slot: number;
    flags: number;
    breakCount: number;
    historyCount: number;
    historyEntries: Uint8Array[];
    addr: number;
  } | null;
  /** 直近のステップ通知（1Bh）。未受信は null */
  lastStepNotify: CpuStateNotifyInfo | null;
  /** 直近の未定義命令通知（13h）。未受信は null */
  lastUndefNotify: CpuStateNotifyInfo | null;
  /** 64bit タイマー（上位バイトが [0]） */
  timestamp: Uint8Array;
  /** 1Ch: PCF8523 生レジスタ（seconds..years の 7 バイト） */
  rtcRaw: Uint8Array;
  /** 1Dh: MCP9808 Ambient Temperature (0x05) 生値 */
  tempRaw: number;
  /** 1Eh: TCS34725 RGBC 生値 */
  lightRaw: {
    clear: number;
    red: number;
    green: number;
    blue: number;
  };
  /** 1Fh: VL53L1X 生値 */
  distanceRaw: {
    distanceMm: number;
    rangeStatus: number;
  };
  log: IoBoardMockLogEntry[];
};

export type IoBoardMockOptions = {
  timeoutMs?: number;
  /** 既定ハンドラの一部だけ差し替え */
  handlers?: Partial<CpuToIoHandlers>;
  /** HSHK_IN_REQ を IRQ2 + pending に接続（既定 true） */
  syncIrq2?: boolean;
  /** ログ最大件数（既定 64） */
  maxLog?: number;
  onLog?: (entry: IoBoardMockLogEntry) => void;
  /** タイマー割り込み（12h）の駆動スケジューラ。既定はグローバル setTimeout */
  timerScheduler?: IoTimerScheduler;
  /**
   * 1Ah 履歴エントリ長（省略時は cpuType または MN1613=66）。
   * HandShake.mdc: MN1613=66 / TMS9995=78
   */
  historyEntrySize?: number;
  /** setting_area の cpuType（1=MN1613, 2=TMS9995）。historyEntrySize 未指定時に使う */
  cpuType?: number;
};

/**
 * 全消灯の LED 表示データを作る。
 * @returns 7セグ 12 桁と砲弾 16 本が 0 のデータ
 */
function emptyLed(): LedDisplayData {
  return {
    sevenSeg: new Uint8Array(12),
    bulletLed0_7: 0,
    bulletLed8_F: 0,
  };
}

/**
 * CPU→IO コマンド用の IO ボード状態の初期値を作る（モニターモード・キー入力なし）。
 * IO ボード Worker でも同じ状態・同じ既定ハンドラを使う。
 * @returns 新しい状態オブジェクト
 */
export function createIoBoardCommandState(): IoBoardMockState {
  return {
    mode: MODE.MONITOR,
    led: null,
    hexKeys: new Uint8Array(8),
    pcKey: { ascii: 0, keyCode: 0 },
    lastBeep: null,
    lastTimer: null,
    undefLed: false,
    addrBreakNo: 0,
    lastBreakNotify: null,
    lastStepNotify: null,
    lastUndefNotify: null,
    timestamp: new Uint8Array(8),
    rtcRaw: new Uint8Array(7),
    tempRaw: 0,
    lightRaw: { clear: 0, red: 0, green: 0, blue: 0 },
    distanceRaw: { distanceMm: 0, rangeStatus: 0 },
    log: [],
  };
}

/**
 * CPU→IO コマンド状態を電源投入／RST 直後に戻す（モニターモード・入力なし）。
 * ハンドラが閉じている同一オブジェクトをその場で初期化する。
 * @param state 更新対象
 */
export function resetIoBoardCommandState(state: IoBoardMockState): void {
  const fresh = createIoBoardCommandState();
  state.mode = fresh.mode;
  state.led = fresh.led;
  state.hexKeys = fresh.hexKeys;
  state.pcKey = fresh.pcKey;
  state.lastBeep = fresh.lastBeep;
  state.lastTimer = fresh.lastTimer;
  state.undefLed = fresh.undefLed;
  state.addrBreakNo = fresh.addrBreakNo;
  state.lastBreakNotify = fresh.lastBreakNotify;
  state.lastStepNotify = fresh.lastStepNotify;
  state.lastUndefNotify = fresh.lastUndefNotify;
  state.timestamp = fresh.timestamp;
  state.rtcRaw = fresh.rtcRaw;
  state.tempRaw = fresh.tempRaw;
  state.lightRaw = fresh.lightRaw;
  state.distanceRaw = fresh.distanceRaw;
  state.log = fresh.log;
  resetUndefLed();
  resetLcdConsole();
}

/**
 * 16進キー 0–F をハンドシェイク 14h の列ビットへ写す。
 * 根拠: HandShake.mdc キー配置（列0 = C 8 4 0 が Bit3–0）。
 * @param digit キー番号 0–15
 * @returns 列 0–3 とビットマスク。範囲外は null
 */
export function hexDigitColumnMask(
  digit: number,
): { col: number; mask: number } | null {
  if (!Number.isInteger(digit) || digit < 0 || digit > 15) return null;
  return panelKeyColumnMask(digit.toString(16).toUpperCase());
}

/**
 * 14h 用のパネルキー押下ビットを更新する（押している間 ON）。
 * キーマトリクスはモードに関係なく保持する（14h の応答だけフリー専用）。
 * @param state IO ボード状態
 * @param key "0"–"F" または "F0"–"F7"
 * @param held true=押下、false=離す
 */
export function setPanelKeyHeld(
  state: IoBoardMockState,
  key: string,
  held: boolean,
): void {
  const loc = panelKeyColumnMask(key);
  if (!loc) return;
  const cur = state.hexKeys[loc.col] ?? 0;
  state.hexKeys[loc.col] = held
    ? (cur | loc.mask) & 0xff
    : cur & ~loc.mask & 0xff;
}

/**
 * 14h 用の 16進キー押下ビットを更新する（押している間 ON）。
 * マトリクスはモード不問。14h で読むときだけフリー必須。
 * @param state IO ボード状態
 * @param digit キー番号 0–15
 * @param held true=押下、false=離す
 */
export function setHexKeyHeld(
  state: IoBoardMockState,
  digit: number,
  held: boolean,
): void {
  if (!Number.isInteger(digit) || digit < 0 || digit > 15) return;
  setPanelKeyHeld(state, digit.toString(16).toUpperCase(), held);
}

/**
 * 状態を持つ既定 CpuToIoHandlers（モニター相手のモック挙動）。
 * @param state 更新対象のモック状態
 * @param timer タイマー設定 (12h) を実際に反映する IO ボードタイマー（1 本）。
 *   省略した場合は設定値を state に記録するだけで割り込みは発生しない
 * @param timeSource 時刻取得 (11h) の 64bit タイマー。省略時は state.timestamp（テスト差し込み用）
 */
export function createDefaultCpuToIoHandlers(
  state: IoBoardMockState,
  timer?: IoTimer | null,
  timeSource?: IoTimeSource,
): CpuToIoHandlers {
  const normalizeCpuStateNotify = (
    info: CpuStateNotifyInfo,
  ): CpuStateNotifyInfo => ({
    addr: info.addr >>> 0,
    r0: info.r0 & 0xffff,
    r1: info.r1 & 0xffff,
    r2: info.r2 & 0xffff,
    r3: info.r3 & 0xffff,
    r4: info.r4 & 0xffff,
    r5to15: (info.r5to15 ?? []).slice(0, 11).map((v) => v & 0xffff),
    sp: info.sp & 0xffff,
    str: info.str & 0xffff,
    ic: info.ic & 0xffff,
    csbrSsbr: info.csbrSsbr & 0xffff,
    tsr: info.tsr & 0xffff,
    npp: info.npp & 0xff,
    stack: info.stack.slice(0, 16),
  });

  return {
    onModeSet(mode) {
      state.mode = mode;
      if (mode !== MODE.FREE) {
        state.hexKeys.fill(0);
      }
      return RESPONSE_CODE.OK;
    },
    getHexKeys() {
      if (state.mode !== MODE.FREE) {
        return {
          columns: new Uint8Array(8),
          status: RESPONSE_CODE.NG_MODE_ERROR,
        };
      }
      return {
        columns: state.hexKeys.slice(),
        status: RESPONSE_CODE.OK,
      };
    },
    getPcKey() {
      return {
        ascii: state.pcKey.ascii,
        keyCode: state.pcKey.keyCode,
        status: RESPONSE_CODE.OK,
      };
    },
    onLedDisplay(data) {
      if (state.mode !== MODE.FREE) {
        return RESPONSE_CODE.NG_MODE_ERROR;
      }
      state.led = {
        sevenSeg: data.sevenSeg.slice(),
        bulletLed0_7: data.bulletLed0_7,
        bulletLed8_F: data.bulletLed8_F,
      };
      applyLedDisplayCommand(data);
      return RESPONSE_CODE.OK;
    },
    onBeep(params) {
      state.lastBeep = { ...params };
      return RESPONSE_CODE.OK;
    },
    onTimerSet(params) {
      state.lastTimer = { ...params };
      if (!timer) return RESPONSE_CODE.OK;
      if (params.timerNo !== 0) return RESPONSE_CODE.NG;
      return timer.configure(params);
    },
    getTime() {
      return {
        timestamp: timeSource
          ? timeSource.readTimestamp()
          : state.timestamp.slice(),
        status: RESPONSE_CODE.OK,
      };
    },
    onBreakNotify(info) {
      state.lastBreakNotify = {
        kind: info.kind & 0xff,
        slot: info.slot & 0xff,
        flags: info.flags & 0xff,
        breakCount: info.breakCount & 0xff,
        historyCount: info.historyCount & 0xff,
        historyEntries: info.historyEntries.map((ent) => ent.slice()),
        addr: info.addr >>> 0,
      };
      return RESPONSE_CODE.OK;
    },
    onStepNotify(info) {
      state.lastStepNotify = normalizeCpuStateNotify(info);
      return RESPONSE_CODE.OK;
    },
    onUndefNotify(info) {
      state.lastUndefNotify = normalizeCpuStateNotify(info);
      state.undefLed = true;
      applyUndefLedCommand(true);
      return RESPONSE_CODE.OK;
    },
    onLcdControl(frame) {
      return lcdConsole.handleControlFrame(frame);
    },
    onLcdText(frame) {
      return lcdConsole.handleTextFrame(frame);
    },
    getRtcRaw() {
      return {
        regs: state.rtcRaw.slice(0, 7),
        status: RESPONSE_CODE.OK,
      };
    },
    getTempRaw() {
      return {
        raw: state.tempRaw & 0xffff,
        status: RESPONSE_CODE.OK,
      };
    },
    getLightRaw() {
      return {
        clear: state.lightRaw.clear & 0xffff,
        red: state.lightRaw.red & 0xffff,
        green: state.lightRaw.green & 0xffff,
        blue: state.lightRaw.blue & 0xffff,
        status: RESPONSE_CODE.OK,
      };
    },
    getDistanceRaw() {
      return {
        distanceMm: state.distanceRaw.distanceMm & 0xffff,
        rangeStatus: state.distanceRaw.rangeStatus & 0x1f,
        status: RESPONSE_CODE.OK,
      };
    },
  };
}

/**
 * HSHK_IN_REQ の変化を IRQ2 に反映する。
 * run() は processInputPins を呼ばないため triggerInterrupt も併用する。
 */
export function wireHshkReq1ToIrq2(bus: CpuIoSignals): () => void {
  let req1: 0 | 1 = bus.HSHK_IN_REQ;
  Object.defineProperty(bus, "HSHK_IN_REQ", {
    configurable: true,
    enumerable: true,
    get(): 0 | 1 {
      return req1;
    },
    set(v: number) {
      const next: 0 | 1 = v ? 1 : 0;
      if (next === req1) return;
      req1 = next;
      const noIrq = Boolean(
        (this as CpuIoSignals & { [HSHK_IN_REQ_NO_IRQ]?: boolean })[
          HSHK_IN_REQ_NO_IRQ
        ],
      );
      if (next === 1 && !noIrq) {
        setPins({ IRQ2: true });
        triggerInterrupt(2);
      } else {
        setPins({ IRQ2: false });
      }
    },
  });
  return () => {
    Object.defineProperty(bus, "HSHK_IN_REQ", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: req1,
    });
    setPins({ IRQ2: false });
  };
}

export class IoBoardHandshakeMock {
  readonly bus: CpuIoSignals;
  readonly state: IoBoardMockState;
  readonly io: IoControlHandshake;
  /**
   * IO ボード側タイマー 1 本（ハンドシェイク 12h のタイマー番号 0 のみ）。
   * 満了で INT2_CAUSE=タイマーのレベル 2 割り込みを上げる。
   */
  readonly timer: IoTimer;

  /** @deprecated timer を参照する */
  get timers(): readonly [IoTimer] {
    return [this.timer];
  }

  private readonly dispatcher: CpuToIoCommandDispatcher;
  private cpuToIoRemaining: (frameSoFar: Uint8Array) => number;
  private readonly timeoutMs: number;
  private readonly maxLog: number;
  private readonly onLog?: (entry: IoBoardMockLogEntry) => void;
  private readonly syncIrq2: boolean;
  private readonly timerScheduler: IoTimerScheduler;

  private unwireIrq2: (() => void) | null = null;
  private serving = false;
  private servePromise: Promise<void> | null = null;
  private abortServe = false;
  /** handleOneRequest / sendToCpu の直列化 */
  private busLock: Promise<void> = Promise.resolve();
  /** 配送待ちのタイマー割り込み（レベル線相当） */
  private timerIrqPending = false;
  private timerIrqRetry: IoTimerHandle | null = null;

  /**
   * @param options タイムアウト、差し替えハンドラ、IRQ2 連動、ログ設定、タイマースケジューラ
   */
  constructor(options: IoBoardMockOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxLog = options.maxLog ?? 64;
    this.onLog = options.onLog;
    this.syncIrq2 = options.syncIrq2 !== false;
    this.timerScheduler = options.timerScheduler ?? {
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h),
    };

    this.bus = createHandshakeBus();
    this.state = createIoBoardCommandState();
    this.io = new IoControlHandshake(this.bus, this.timeoutMs);
    this.timer = new IoTimer({
      onExpire: () => this.requestTimerInterrupt(),
      scheduler: this.timerScheduler,
    });

    const base = createDefaultCpuToIoHandlers(this.state, this.timer);
    const handlers: CpuToIoHandlers = { ...base, ...options.handlers };
    const historyEntrySize =
      options.historyEntrySize ??
      (options.cpuType !== undefined
        ? breakHistoryEntrySizeForCpu(options.cpuType)
        : BREAK_HISTORY_ENTRY_SIZE_MN1613);
    this.dispatcher = new CpuToIoCommandDispatcher(handlers, {
      historyEntrySize,
    });
    this.cpuToIoRemaining = makeCpuToIoRemainingSize(historyEntrySize);
  }

  /**
   * 1Ah 履歴エントリ長を切り替える（設定エリアの CPU 種類変更時など）。
   * @param entrySize バイト長（MN1613=66 / TMS9995=78）
   */
  setHistoryEntrySize(entrySize: number): void {
    this.dispatcher.setHistoryEntrySize(entrySize);
    this.cpuToIoRemaining = makeCpuToIoRemainingSize(entrySize);
  }

  /** CPU の RD/WT をこのバスに接続する */
  attach(): void {
    const bridge = createHandshakeIoPortBridge(this.bus);
    setIoReadCallback((p) => bridge.read(p));
    setIoWriteCallback((p, v) => bridge.write(p, v));
    if (this.syncIrq2 && !this.unwireIrq2) {
      this.unwireIrq2 = wireHshkReq1ToIrq2(this.bus);
    }
  }

  /** CPU の RD/WT 接続と IRQ2 連動を解除して初期状態へ戻す */
  detach(): void {
    void this.stop();
    this.stopTimers();
    this.unwireIrq2?.();
    this.unwireIrq2 = null;
    setIoReadCallback(() => 0);
    setIoWriteCallback(() => {});
    setPins({ IRQ2: false });
  }

  /** タイマーを止め、配送待ちのタイマー割り込みも捨てる */
  stopTimers(): void {
    this.timer.stop();
    this.timerIrqPending = false;
    if (this.timerIrqRetry !== null) {
      this.timerScheduler.clearTimeout(this.timerIrqRetry);
      this.timerIrqRetry = null;
    }
  }

  /**
   * タイマー満了 1 回分の割り込み配送を要求する。
   * 割り込み処理中／ハンドシェイク中は INT_CAUSE を壊さないよう配送を保留する。
   */
  private requestTimerInterrupt(): void {
    this.timerIrqPending = true;
    this.flushTimerInterrupt();
  }

  /**
   * 保留中のタイマー割り込みを配送する。
   * INTERRUPT_BUSY=1（CPU が割り込み処理中）またはハンドシェイク線が動作中の間は
   * INT_CAUSE の取り違えを避けるため配送せず、短い間隔で再試行する。
   */
  private flushTimerInterrupt(): void {
    if (!this.timerIrqPending) return;
    const handshakeBusy =
      this.bus.HSHK_OUT_REQ === 1 ||
      this.bus.HSHK_OUT_DENA === 1 ||
      this.bus.HSHK_IN_DACK === 1 ||
      this.bus.HSHK_IN_REQ === 1 ||
      this.bus.HSHK_IN_DENA === 1 ||
      this.bus.HSHK_OUT_DACK === 1;
    if (this.bus.INTERRUPT_BUSY === 1 || handshakeBusy) {
      this.scheduleTimerIrqRetry();
      return;
    }
    this.timerIrqPending = false;
    this.bus.INT_CAUSE = intCauseForTimer();
    setPins({ IRQ2: true });
    triggerInterrupt(2);
    setPins({ IRQ2: false });
    if (this.timerIrqPending) this.scheduleTimerIrqRetry();
  }

  /** 配送の再試行を 1 件だけ予約する（既に予約済みなら何もしない） */
  private scheduleTimerIrqRetry(): void {
    if (this.timerIrqRetry !== null) return;
    this.timerIrqRetry = this.timerScheduler.setTimeout(() => {
      this.timerIrqRetry = null;
      this.flushTimerInterrupt();
    }, TIMER_IRQ_RETRY_MS);
  }

  /**
   * バックグラウンドで CPU→IO 要求を待ち、ディスパッチして応答する。
   * モニターを run() / CPU Worker と並行して動かすときに使う。
   */
  start(): void {
    if (this.serving) return;
    this.abortServe = false;
    this.serving = true;
    this.servePromise = this.serveLoop().finally(() => {
      this.serving = false;
      this.servePromise = null;
    });
  }

  /**
   * 受信ループを止める。receive 待ちはタイムアウトで抜けるため、
   * テストでは短い timeoutMs を渡すこと。
   */
  async stop(): Promise<void> {
    if (!this.serving) return;
    this.abortServe = true;
    // receive 待ちを起こすため REQ を触らない（タイムアウト待ち）。
    // テストでは短い timeoutMs を渡すこと。
    await this.servePromise?.catch(() => undefined);

    // stop 直後に次の exchangeWithCpu を行うテスト向けに、IO 側の線をアイドルへ戻す。
    this.bus.HSHK_OUT_DACK = 0;
    this.bus.HSHK_IN_DENA = 0;
    setHshkInReq(this.bus, 0, false);

    // CPU 側の OUT_REQ/OUT_DENA が自然に落ちるのを短く待つ（落ちなければそのまま返す）。
    await waitCondition(
      () =>
        this.bus.HSHK_OUT_REQ === 0 &&
        this.bus.HSHK_OUT_DENA === 0 &&
        this.bus.HSHK_IN_DACK === 0,
      50,
    ).catch(() => undefined);
  }

  /**
   * 受信ループが動いているか。
   * @returns start() 済みで停止していなければ true
   */
  get isServing(): boolean {
    return this.serving;
  }

  /**
   * CPU→IO を1トランザクション処理（受信→dispatch→応答送信）。
   * start() せずに Promise.all([run(), mock.handleOneRequest()]) でも使える。
   */
  handleOneRequest(): Promise<Uint8Array> {
    return this.withBusLock(async () => {
      const frame = await this.io.receiveFramedAdaptive(this.cpuToIoRemaining);
      const response = this.dispatcher.dispatch(frame);
      this.pushLog({
        at: Date.now(),
        dir: "cpu_to_io",
        cmd: frame[0] ?? 0,
        frame: frame.slice(),
        response: response.slice(),
      });
      if (response.length > 0) {
        await this.io.send(response, { raiseIrq: false });
      }
      return response;
    });
  }

  /** IO→CPU へ任意ペイロードを送る（コマンド試験・モニター割り込み経路） */
  sendToCpu(data: Uint8Array): Promise<void> {
    return this.withBusLock(async () => {
      this.pushLog({
        at: Date.now(),
        dir: "io_to_cpu",
        cmd: data[0] ?? 0,
        frame: data.slice(),
      });
      await this.io.send(data);
    });
  }

  /**
   * IO→CPU を送り、同一トランザクションで CPU→IO 応答を受け取る。
   * 11h（送信＋NG 1B）など、応答後に IO→CPU を足す場合向け。
   * @param toCpu IO→CPU バイト列
   * @param fromCpu CPU→IO で待つバイト数
   * @param thenToCpu 応答後の追加 IO→CPU（OK/NG など）
   * @returns CPU→IO で受け取ったバイト
   */
  exchangeWithCpu(
    toCpu: Uint8Array,
    fromCpu: number,
    thenToCpu?: Uint8Array,
  ): Promise<Uint8Array> {
    return this.withBusLock(async () => {
      this.pushLog({
        at: Date.now(),
        dir: "io_to_cpu",
        cmd: toCpu[0] ?? 0,
        frame: toCpu.slice(),
      });
      const reply = await this.io.sendReceive(toCpu, fromCpu, thenToCpu);
      this.pushLog({
        at: Date.now(),
        dir: "cpu_to_io",
        cmd: toCpu[0] ?? 0,
        frame: toCpu.slice(),
        response: reply.slice(),
      });
      return reply;
    });
  }

  /**
   * IO→CPU 13h でメモリを読む（同一 ENA。ヘッダ＋データ＋status）。
   * @param byteAddr 開始バイトアドレス
   * @param byteCount バイト数（0 ならヘッダのみ）
   * @returns 読み出したバイト列
   */
  memReadFromCpu(byteAddr: number, byteCount: number): Promise<Uint8Array> {
    return this.withBusLock(async () => {
      this.pushLog({
        at: Date.now(),
        dir: "io_to_cpu",
        cmd: CMD_IO_TO_CPU.MEM_READ,
        frame: Uint8Array.from([CMD_IO_TO_CPU.MEM_READ]),
      });
      const data = await this.io.memRead(byteAddr, byteCount);
      this.pushLog({
        at: Date.now(),
        dir: "cpu_to_io",
        cmd: CMD_IO_TO_CPU.MEM_READ,
        frame: Uint8Array.from([CMD_IO_TO_CPU.MEM_READ]),
        response: data.slice(),
      });
      return data;
    });
  }

  /**
   * バス操作を直列化する（受信処理と送信が混ざらないようにする）。
   * @param fn バスを使う処理
   * @returns fn の結果
   */
  private withBusLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busLock.then(fn, fn);
    this.busLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 16進キーの押下ビットマップを差し込む（コマンド 14h の応答値）。
   * @param columns 列 0〜7 のビットマップ。8 要素を超える分は捨てる
   */
  setHexKeys(columns: Uint8Array | number[]): void {
    const src =
      columns instanceof Uint8Array ? columns : Uint8Array.from(columns);
    this.state.hexKeys.fill(0);
    this.state.hexKeys.set(src.slice(0, 8));
  }

  /**
   * PC キー入力を差し込む（コマンド 15h の応答値）。
   * @param ascii ASCII コード
   * @param keyCode ホスト側キーコード
   */
  setPcKey(ascii: number, keyCode: number): void {
    this.state.pcKey = { ascii: ascii & 0xff, keyCode: keyCode & 0xff };
  }

  /**
   * 時刻取得（11h）で返す 64bit タイマー値を設定する。
   * @param bytes bigint なら上位バイト先頭の 8 バイトに展開、Uint8Array ならそのまま先頭 8 バイト
   */
  setTimestamp(bytes: Uint8Array | bigint): void {
    if (typeof bytes === "bigint") {
      const out = new Uint8Array(8);
      let v = bytes;
      for (let i = 7; i >= 0; i--) {
        out[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      this.state.timestamp = out;
      return;
    }
    this.state.timestamp = new Uint8Array(8);
    this.state.timestamp.set(bytes.slice(0, 8));
  }

  /**
   * アドレスブレイク情報で返すブレイク番号を設定する。
   * @param n ブレイク番号（下位 2bit のみ有効）
   */
  setAddrBreakNo(n: number): void {
    this.state.addrBreakNo = n & 0x03;
  }

  /** 記録済みの LED 表示内容を全消灯に戻す */
  clearLed(): void {
    this.state.led = emptyLed();
  }

  /**
   * REQ_0 を短いスライスで待ち、1 件ずつ処理し続ける。
   * タイムアウトと ENA0 チェック失敗は継続、それ以外の例外は投げ直す。
   */
  private async serveLoop(): Promise<void> {
    while (!this.abortServe) {
      try {
        // 短いスライスで REQ_0 / stop を待ち、stop() がタイムアウト一杯待たないようにする
        await waitCondition(
          () => this.abortServe || this.bus.HSHK_OUT_REQ === 1,
          1,
        );
        if (this.abortServe) return;
        await this.handleOneRequest();
      } catch (err) {
        if (this.abortServe) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("timeout") || msg.includes("ENA0")) {
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * 通信ログを追記する（maxLog を超えたら古い順に捨てる）。
   * @param entry 追加するログエントリ
   */
  private pushLog(entry: IoBoardMockLogEntry): void {
    this.state.log.push(entry);
    while (this.state.log.length > this.maxLog) {
      this.state.log.shift();
    }
    this.onLog?.(entry);
  }
}

/** attach 済みのモックを生成するショートカット */
export function createIoBoardHandshakeMock(
  options?: IoBoardMockOptions,
): IoBoardHandshakeMock {
  const mock = new IoBoardHandshakeMock(options);
  mock.attach();
  return mock;
}
