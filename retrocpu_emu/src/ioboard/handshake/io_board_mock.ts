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
  CpuToIoCommandDispatcher,
  CPU_PAYLOAD_REMAINING_SIZE,
  type BeepParams,
  type CpuToIoHandlers,
  type LedDisplayData,
  type TimerParams,
} from "./command_cpu_to_io";
import { IoControlHandshake } from "../../shared/handshake/handshake_ioboard";
import {
  CMD_IO_TO_CPU,
  createHandshakeBus,
  DEFAULT_TIMEOUT_MS,
  intCauseForTimer,
  MODE,
  RESPONSE_CODE,
  waitCondition,
} from "../../shared/handshake/handshake_type";
import { createHandshakeIoPortBridge } from "../../cpuboard/handshake/io_port_bridge";
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
  /** 未定義命令LED（13h）。true=点灯 */
  undefLed: boolean;
  addrBreakNo: number;
  /** 直近のブレイク通知（1Ah）。未受信は null */
  lastBreakNotify: { kind: number; slot: number; addr: number } | null;
  /** 直近のステップ通知（1Bh）。未受信は null */
  lastStepNotify: {
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
  } | null;
  /** 64bit タイマー（上位バイトが [0]） */
  timestamp: Uint8Array;
  log: IoBoardMockLogEntry[];
};

export type IoBoardMockOptions = {
  timeoutMs?: number;
  /** 既定ハンドラの一部だけ差し替え */
  handlers?: Partial<CpuToIoHandlers>;
  /** HSHK_REQ_1 を IRQ2 + pending に接続（既定 true） */
  syncIrq2?: boolean;
  /** ログ最大件数（既定 64） */
  maxLog?: number;
  onLog?: (entry: IoBoardMockLogEntry) => void;
  /** タイマー割り込み（12h）の駆動スケジューラ。既定はグローバル setTimeout */
  timerScheduler?: IoTimerScheduler;
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
    timestamp: new Uint8Array(8),
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
  state.timestamp = fresh.timestamp;
  state.log = fresh.log;
  resetUndefLed();
  resetLcdConsole();
}

/**
 * 状態を持つ既定 CpuToIoHandlers（モニター相手のモック挙動）。
 * @param state 更新対象のモック状態
 * @param timers タイマー設定 (12h) を実際に反映する IO ボードタイマー（番号 0/1 の 2 本）。
 *   省略した場合は設定値を state に記録するだけで割り込みは発生しない
 * @param timeSource 時刻取得 (11h) の 64bit タイマー。省略時は state.timestamp（テスト差し込み用）
 */
export function createDefaultCpuToIoHandlers(
  state: IoBoardMockState,
  timers?: readonly IoTimer[],
  timeSource?: IoTimeSource,
): CpuToIoHandlers {
  return {
    onModeSet(mode) {
      state.mode = mode;
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
      if (!timers) return RESPONSE_CODE.OK;
      const target = timers[params.timerNo];
      if (!target) return RESPONSE_CODE.NG;
      return target.configure(params);
    },
    getTime() {
      return {
        timestamp: timeSource
          ? timeSource.readTimestamp()
          : state.timestamp.slice(),
        status: RESPONSE_CODE.OK,
      };
    },
    onUndefLed(on) {
      state.undefLed = on;
      applyUndefLedCommand(on);
      return RESPONSE_CODE.OK;
    },
    onBreakNotify(info) {
      state.lastBreakNotify = {
        kind: info.kind & 0xff,
        slot: info.slot & 0xff,
        addr: info.addr >>> 0,
      };
      return RESPONSE_CODE.OK;
    },
    onStepNotify(info) {
      state.lastStepNotify = {
        addr: info.addr >>> 0,
        r0: info.r0 & 0xffff,
        r1: info.r1 & 0xffff,
        r2: info.r2 & 0xffff,
        r3: info.r3 & 0xffff,
        r4: info.r4 & 0xffff,
        sp: info.sp & 0xffff,
        str: info.str & 0xffff,
        ic: info.ic & 0xffff,
        csbrSsbr: info.csbrSsbr & 0xffff,
        tsr: info.tsr & 0xffff,
        npp: info.npp & 0xff,
        stack: info.stack.slice(0, 16),
      };
      return RESPONSE_CODE.OK;
    },
    onLcdControl(frame) {
      return lcdConsole.handleControlFrame(frame);
    },
    onLcdText(frame) {
      return lcdConsole.handleTextFrame(frame);
    },
  };
}

/**
 * HSHK_REQ_1 の変化を IRQ2 に反映する。
 * run() は processInputPins を呼ばないため triggerInterrupt も併用する。
 */
export function wireHshkReq1ToIrq2(bus: CpuIoSignals): () => void {
  let req1: 0 | 1 = bus.HSHK_REQ_1;
  Object.defineProperty(bus, "HSHK_REQ_1", {
    configurable: true,
    enumerable: true,
    get(): 0 | 1 {
      return req1;
    },
    set(v: number) {
      const next: 0 | 1 = v ? 1 : 0;
      if (next === req1) return;
      req1 = next;
      if (next === 1) {
        setPins({ IRQ2: true });
        triggerInterrupt(2);
      } else {
        setPins({ IRQ2: false });
      }
    },
  });
  return () => {
    Object.defineProperty(bus, "HSHK_REQ_1", {
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
   * IO ボード側タイマー 2 本（ハンドシェイク 12h のタイマー番号 0 / 1）。
   * 満了で INT_CAUSE=番号 のレベル 2 割り込みを上げる。
   */
  readonly timers: readonly [IoTimer, IoTimer];

  private readonly dispatcher: CpuToIoCommandDispatcher;
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
  /** 配送待ちのタイマー番号（レベル線相当なので同一番号の回数は畳む） */
  private readonly timerIrqPending = new Set<number>();
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
    this.timers = [
      new IoTimer({
        onExpire: () => this.requestTimerInterrupt(0),
        scheduler: this.timerScheduler,
      }),
      new IoTimer({
        onExpire: () => this.requestTimerInterrupt(1),
        scheduler: this.timerScheduler,
      }),
    ];

    const base = createDefaultCpuToIoHandlers(this.state, this.timers);
    const handlers: CpuToIoHandlers = { ...base, ...options.handlers };
    this.dispatcher = new CpuToIoCommandDispatcher(handlers);
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

  /** タイマー 2 本を止め、配送待ちのタイマー割り込みも捨てる */
  stopTimers(): void {
    for (const t of this.timers) t.stop();
    this.timerIrqPending.clear();
    if (this.timerIrqRetry !== null) {
      this.timerScheduler.clearTimeout(this.timerIrqRetry);
      this.timerIrqRetry = null;
    }
  }

  /**
   * タイマー満了 1 回分の割り込み配送を要求する。
   * 割り込み処理中／ハンドシェイク中は INT_CAUSE を壊さないよう配送を保留する。
   * @param timerNo 満了したタイマー番号（0 または 1）
   */
  private requestTimerInterrupt(timerNo: number): void {
    this.timerIrqPending.add(timerNo);
    this.flushTimerInterrupt();
  }

  /**
   * 保留中のタイマー割り込みを 1 件配送する。
   * INTERRUPT_BUSY=1（CPU が割り込み処理中）または HSHK_ENA=1（転送中）の間は
   * INT_CAUSE の取り違えを避けるため配送せず、短い間隔で再試行する。
   * 2 本同時に満了した場合も要因が混ざらないよう 1 件ずつ配送する。
   */
  private flushTimerInterrupt(): void {
    if (this.timerIrqPending.size === 0) return;
    if (this.bus.INTERRUPT_BUSY === 1 || this.bus.HSHK_ENA === 1) {
      this.scheduleTimerIrqRetry();
      return;
    }
    const timerNo = [...this.timerIrqPending][0]!;
    this.timerIrqPending.delete(timerNo);
    this.bus.INT_CAUSE = intCauseForTimer(timerNo);
    setPins({ IRQ2: true });
    triggerInterrupt(2);
    setPins({ IRQ2: false });
    if (this.timerIrqPending.size > 0) this.scheduleTimerIrqRetry();
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
      const frame = await this.io.receiveFramed(
        (cmd) => CPU_PAYLOAD_REMAINING_SIZE[cmd] ?? 0,
      );
      const response = this.dispatcher.dispatch(frame);
      this.pushLog({
        at: Date.now(),
        dir: "cpu_to_io",
        cmd: frame[0] ?? 0,
        frame: frame.slice(),
        response: response.slice(),
      });
      if (response.length > 0) {
        await this.io.send(response);
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
          () => this.abortServe || this.bus.HSHK_REQ_0 === 1,
          100,
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
