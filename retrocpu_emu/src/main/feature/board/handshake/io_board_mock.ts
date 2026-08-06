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
} from "../../cpu/mn1613/mn1613";
import type { CpuIoSignals } from "../../cpu/mn1613/mn1613ioport";
import {
  CpuToIoCommandDispatcher,
  CPU_PAYLOAD_REMAINING_SIZE,
  type BeepParams,
  type CpuRegisters,
  type CpuToIoHandlers,
  type LedDisplayData,
  type TimerParams,
} from "../../cpu/mn1613/handhshake/command_cpu_to_io";
import { IoControlHandshake } from "../../cpu/mn1613/handhshake/handshake_ioboard";
import {
  createHandshakeBus,
  DEFAULT_TIMEOUT_MS,
  MODE,
  RESPONSE_CODE,
  waitCondition,
} from "../../cpu/mn1613/handhshake/handshake_type";
import { createHandshakeIoPortBridge } from "./io_port_bridge";

export type IoBoardMockLogEntry = {
  at: number;
  dir: "cpu_to_io" | "io_to_cpu";
  cmd: number;
  frame: Uint8Array;
  response?: Uint8Array;
};

export type IoBoardMockState = {
  mode: number;
  lastCpuRegs: CpuRegisters | null;
  led: LedDisplayData | null;
  hexKeys: Uint8Array;
  pcKey: { ascii: number; keyCode: number };
  lastBeep: BeepParams | null;
  lastTimer: TimerParams | null;
  addrBreakNo: number;
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
};

function emptyLed(): LedDisplayData {
  return {
    sevenSeg: new Uint8Array(10),
    bulletLed0_7: 0,
    bulletLed8_F: 0,
  };
}

function createInitialState(): IoBoardMockState {
  return {
    mode: MODE.MONITOR,
    lastCpuRegs: null,
    led: null,
    hexKeys: new Uint8Array(8),
    pcKey: { ascii: 0, keyCode: 0 },
    lastBeep: null,
    lastTimer: null,
    addrBreakNo: 0,
    timestamp: new Uint8Array(8),
    log: [],
  };
}

/**
 * 状態を持つ既定 CpuToIoHandlers（モニター相手のモック挙動）。
 */
export function createDefaultCpuToIoHandlers(
  state: IoBoardMockState,
): CpuToIoHandlers {
  return {
    onCpuStatusNotify(regs) {
      state.lastCpuRegs = regs;
      return RESPONSE_CODE.OK;
    },
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
      return RESPONSE_CODE.OK;
    },
    onBeep(params) {
      state.lastBeep = { ...params };
      return RESPONSE_CODE.OK;
    },
    onTimerSet(params) {
      state.lastTimer = { ...params };
      return RESPONSE_CODE.OK;
    },
    getAddrBreakInfo() {
      return {
        breakNo: state.addrBreakNo & 0x03,
        timestamp: state.timestamp.slice(),
        status: RESPONSE_CODE.OK,
      };
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

  private readonly dispatcher: CpuToIoCommandDispatcher;
  private readonly timeoutMs: number;
  private readonly maxLog: number;
  private readonly onLog?: (entry: IoBoardMockLogEntry) => void;
  private readonly syncIrq2: boolean;

  private unwireIrq2: (() => void) | null = null;
  private serving = false;
  private servePromise: Promise<void> | null = null;
  private abortServe = false;
  /** handleOneRequest / sendToCpu の直列化 */
  private busLock: Promise<void> = Promise.resolve();

  constructor(options: IoBoardMockOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxLog = options.maxLog ?? 64;
    this.onLog = options.onLog;
    this.syncIrq2 = options.syncIrq2 !== false;

    this.bus = createHandshakeBus();
    this.state = createInitialState();
    this.io = new IoControlHandshake(this.bus, this.timeoutMs);

    const base = createDefaultCpuToIoHandlers(this.state);
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

  detach(): void {
    void this.stop();
    this.unwireIrq2?.();
    this.unwireIrq2 = null;
    setIoReadCallback(() => 0);
    setIoWriteCallback(() => {});
    setPins({ IRQ2: false });
  }

  /**
   * バックグラウンドで CPU→IO 要求を待ち、ディスパッチして応答する。
   * モニターを run() / emu_loop と並行して動かすときに使う。
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

  async stop(): Promise<void> {
    if (!this.serving) return;
    this.abortServe = true;
    // receive 待ちを起こすため REQ を触らない（タイムアウト待ち）。
    // テストでは短い timeoutMs を渡すこと。
    await this.servePromise?.catch(() => undefined);
  }

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

  private withBusLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busLock.then(fn, fn);
    this.busLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  setHexKeys(columns: Uint8Array | number[]): void {
    const src = columns instanceof Uint8Array ? columns : Uint8Array.from(columns);
    this.state.hexKeys.fill(0);
    this.state.hexKeys.set(src.slice(0, 8));
  }

  setPcKey(ascii: number, keyCode: number): void {
    this.state.pcKey = { ascii: ascii & 0xff, keyCode: keyCode & 0xff };
  }

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

  setAddrBreakNo(n: number): void {
    this.state.addrBreakNo = n & 0x03;
  }

  clearLed(): void {
    this.state.led = emptyLed();
  }

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
