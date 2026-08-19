/**
 * IO ボード Worker（1階相当）
 * - ファンクションキー／16進コンソール（ioboard.mdc）
 * - メモリ R/W はハンドシェイク（13h/14h）
 * - Cursor の Intel HEX は DMA 書き込み
 * - F7 RST / 電源投入: ブートモニタ IHX を DMA して CPU リセット
 */

import { parentPort, workerData, type MessagePort } from "node:worker_threads";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  attachSharedBoard,
  clockCountFromHiLo,
  CTRL,
  EXEC_CODE,
  STATUS,
  type SharedBoard,
} from "../shared/shared_board";
import { setCpuToIoRequest, tickIoBoard } from "./io_board";
import { getLedDisplayWire, resetLedDisplay } from "./seven_led/io_led";
import { getLcdWire, resetLcdConsole } from "./lcd_console";
import { getUndefLed, resetUndefLed } from "./bullet_led/io_undef_led";
import { BoardLinkClient } from "./board_link_client";
import { IoConsole, type ConsoleFnKey } from "./hex_keyboard/io_console";
import { dmaLoadIntelHex } from "./intel_hex_dma";
import type { EmuSnapshot } from "../shared/emu_types";
import { getLogger, initLogging } from "../log/logger";
import { IoTimer } from "./timer/io_timer";
import { IoTimeCounter } from "./timer/io_time";
import {
  createDefaultCpuToIoHandlers,
  createIoBoardCommandState,
  resetIoBoardCommandState,
  setHexKeyHeld,
} from "./handshake/io_board_mock";
import { performIoBoardReset, resolveBootMonitorHexPath } from "./io_reset";
import {
  CpuToIoCommandDispatcher,
  type CpuToIoHandlers,
} from "./handshake/command_cpu_to_io";
import {
  CMD_CPU_TO_IO,
  intCauseForTimer,
} from "../shared/handshake/handshake_type";
import { DebugHost } from "./debug_host";
import {
  OFFSETS,
  createFileSettingAreaStorage,
  decodeSettingArea,
  initializeSettingArea,
  writeSettingAreaByte,
  type SettingAreaStorage,
} from "./setting_area";

type WorkerInit = {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  sliceMs?: number;
  logDir?: string;
  /** ブートモニタ IHX（省略時は探索 / RETROCPU_BOOT_MONITOR_HEX） */
  bootMonitorHex?: string;
  /** IO ボード設定エリア保存先（省略時は logDir の親配下） */
  settingAreaPath?: string;
  /** デバッグ TCP 待ち受けポート（省略時は既定値） */
  debugPort?: number;
};

const init = workerData as WorkerInit;
initLogging({ source: "io", dir: init.logDir });
const log = getLogger("io");
const board: SharedBoard = attachSharedBoard(init);
const sliceMs = init.sliceMs ?? 16;
const link = new BoardLinkClient();
let debugHost: DebugHost | null = null;

const settingAreaPath =
  init.settingAreaPath ??
  path.join(
    path.dirname(init.logDir ?? process.cwd()),
    "ioboard_setting_area.bin",
  );
const settingStorage: SettingAreaStorage =
  createFileSettingAreaStorage(settingAreaPath);
let settingRaw: Uint8Array | null = null;
let settingInitPromise: Promise<void> | null = null;

const CPU_TEMP_CACHE_MS = 1000;
let cachedCpuTempC = 42.0;
let cachedCpuTempAt = 0;

function toBcd(value: number): number {
  const v = Math.max(0, Math.min(99, value | 0));
  return (((Math.floor(v / 10) & 0x0f) << 4) | (v % 10)) & 0xff;
}

function buildPcf8523RegsFromNow(now = new Date()): Uint8Array {
  return new Uint8Array([
    toBcd(now.getSeconds()) & 0x7f,
    toBcd(now.getMinutes()) & 0x7f,
    toBcd(now.getHours()) & 0x3f,
    toBcd(now.getDate()) & 0x3f,
    now.getDay() & 0x07,
    toBcd(now.getMonth() + 1) & 0x1f,
    toBcd(now.getFullYear() % 100),
  ]);
}

function readLinuxCpuTempC(): number | null {
  try {
    const entries = readdirSync("/sys/class/thermal", {
      withFileTypes: true,
    });
    const zones = entries
      .filter((e) => e.isDirectory() && e.name.startsWith("thermal_zone"))
      .map((e) => e.name)
      .sort();
    const values: number[] = [];
    for (const zone of zones) {
      const raw = readFileSync(
        `/sys/class/thermal/${zone}/temp`,
        "utf8",
      ).trim();
      const milli = Number.parseInt(raw, 10);
      if (!Number.isFinite(milli)) continue;
      const c = milli / 1000;
      if (c >= -40 && c <= 200) values.push(c);
    }
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  } catch {
    return null;
  }
}

function getHostCpuTempC(nowMs = Date.now()): number {
  if (nowMs - cachedCpuTempAt <= CPU_TEMP_CACHE_MS) {
    return cachedCpuTempC;
  }
  const sampled = readLinuxCpuTempC();
  if (sampled !== null) cachedCpuTempC = sampled;
  cachedCpuTempAt = nowMs;
  return cachedCpuTempC;
}

function encodeMcp9808AmbientTempRaw(tempC: number): number {
  // MCP9808 ambient temperature register (0x05): sign bit 12, 0.0625C/LSB.
  const clamped = Math.max(-40, Math.min(125, tempC));
  if (clamped >= 0) {
    return Math.round(clamped * 16) & 0x0fff;
  }
  const encoded = Math.round((clamped + 256) * 16) & 0x0fff;
  return encoded | 0x1000;
}

function randomWord(): number {
  return Math.floor(Math.random() * 0x10000) & 0xffff;
}

function randomDistanceMm(): number {
  return (50 + Math.floor(Math.random() * 1951)) & 0xffff;
}

function createEmulatorSensorHandlers(): Pick<
  CpuToIoHandlers,
  "getRtcRaw" | "getTempRaw" | "getLightRaw" | "getDistanceRaw"
> {
  return {
    getRtcRaw() {
      return { regs: buildPcf8523RegsFromNow(), status: 0x00 };
    },
    getTempRaw() {
      const raw = encodeMcp9808AmbientTempRaw(getHostCpuTempC());
      return { raw, status: 0x00 };
    },
    getLightRaw() {
      return {
        clear: randomWord(),
        red: randomWord(),
        green: randomWord(),
        blue: randomWord(),
        status: 0x00,
      };
    },
    getDistanceRaw() {
      return {
        distanceMm: randomDistanceMm(),
        // Datasheet-style 5-bit range status field
        rangeStatus: Math.floor(Math.random() * 0x20) & 0x1f,
        status: 0x00,
      };
    },
  };
}

/**
 * 設定エリアをストレージから読み、マーク不正なら MN1613 既定で初期化する。
 * 00-01 を壊したあと IO ボードリセットしたときに再初期化する。
 */
async function reloadSettingArea(): Promise<void> {
  const inited = await initializeSettingArea(settingStorage);
  settingRaw = inited.raw.slice();
  if (inited.initialized) {
    log.info("設定エリアを初期化", {
      path: settingAreaPath,
      reason: inited.reason,
    });
  }
}

async function ensureSettingAreaReady(): Promise<void> {
  if (settingRaw) return;
  if (!settingInitPromise) {
    settingInitPromise = reloadSettingArea();
  }
  await settingInitPromise;
}

async function readSettingByte(byteAddr: number): Promise<number> {
  await ensureSettingAreaReady();
  return settingRaw?.[byteAddr & 0xff] ?? 0xff;
}

async function writeSettingByte(
  byteAddr: number,
  value: number,
): Promise<void> {
  await ensureSettingAreaReady();
  if (!settingRaw) return;
  const addr = byteAddr & 0xff;
  const before = settingRaw[OFFSETS.CPU_TYPE_RESET] & 0x01;
  settingRaw = writeSettingAreaByte(settingRaw, addr, value);
  const after = settingRaw[OFFSETS.CPU_TYPE_RESET] & 0x01;
  if (
    addr === OFFSETS.CPU_TYPE_RESET &&
    before === 0 &&
    after === 0 &&
    (value & 0x01) === 1
  ) {
    log.info("設定エリア CPU 種類再設定を適用");
  }

  await settingStorage.write(settingRaw);
}

resetLedDisplay();
resetUndefLed();

const consolePanel = new IoConsole({
  async memReadWord(wordAddr) {
    const bytes = await link.memReadBytes(wordAddr, 2);
    return ((bytes[0]! << 8) | bytes[1]!) & 0xffff;
  },
  async memWriteWord(wordAddr, word) {
    const hi = (word >>> 8) & 0xff;
    const lo = word & 0xff;
    await link.memWriteBytes(wordAddr, new Uint8Array([hi, lo]));
  },
  async readSettingByte(byteAddr) {
    return await readSettingByte(byteAddr);
  },
  async writeSettingByte(byteAddr, value) {
    await writeSettingByte(byteAddr, value);
  },
  async exec(wordAddr) {
    await link.exec(wordAddr);
  },
  async setHalt(halt) {
    await link.setHalt(halt);
  },
  async pulseReset() {
    await runIoBoardReset("panel");
  },
  isHalted() {
    return Atomics.load(board.stat, STATUS.EXEC) !== EXEC_CODE.running;
  },
});

let resetBusy = false;

/**
 * 1階リセット: 周辺を初期化し、ブートモニタを DMA して CPU RST する。
 * @param reason ログ用（power-on / F7 / panel）
 */
async function runIoBoardReset(reason: string): Promise<void> {
  if (resetBusy) {
    log.warn("リセット処理中のため無視", { reason });
    return;
  }
  resetBusy = true;
  try {
    intervalTimer.stop();
    resetIoBoardCommandState(cmdState);
    resetLedDisplay();
    resetUndefLed();
    resetLcdConsole();
    emitBeep(0, 0);
    await reloadSettingArea();
    settingInitPromise = Promise.resolve();
    const resetVectorWord = settingRaw
      ? decodeSettingArea(settingRaw).resetVector & 0xffff
      : 0x0108;
    const hexPath = resolveBootMonitorHexPath(init.bootMonitorHex);
    log.info("IO ボードリセット開始", {
      reason,
      hexPath,
      resetVectorWord,
    });
    const result = await performIoBoardReset(link, hexPath, resetVectorWord);
    consolePanel.notifyCpuReset();
    log.info("IO ボードリセット完了", {
      reason,
      bytesWritten: result.bytesWritten,
      hexPath: result.hexPath,
      resetVectorWord,
    });
  } finally {
    resetBusy = false;
  }
}

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ioFrame = 0;
let lastExecStatus: EmuSnapshot["status"] | null = null;
let lastUndefInsn = false;

/**
 * タイマー満了をレベル 2 割り込みとして CPU ボードへ送る。
 * 割り込み要因は INT2_CAUSE=タイマー（0x00）。
 */
function raiseTimerInterrupt(): void {
  void link.raiseInterrupt(2, intCauseForTimer()).catch((e: unknown) => {
    log.error("タイマー割り込みの配送に失敗", {
      err: e instanceof Error ? e.message : String(e),
    });
  });
}

/** IO ボードのタイマー 1 本（ハンドシェイク 12h のタイマー番号 0 のみ） */
const intervalTimer = new IoTimer({ onExpire: () => raiseTimerInterrupt() });

/** 64bit 時刻（11h）。IO ボード開始で 0 クリア、だいたい 10µs ごとに +1 */
const wallClock = new IoTimeCounter();

/**
 * CPU→IO コマンド状態と既定ハンドラ。
 * 10h〜1Fh（HandShake.mdc 概要表の実装済み範囲）を受理する。
 */
const cmdState = createIoBoardCommandState();
const cmdHandlers: CpuToIoHandlers = {
  ...createDefaultCpuToIoHandlers(cmdState, intervalTimer, wallClock),
  ...createEmulatorSensorHandlers(),
};
const cmdDispatcher = new CpuToIoCommandDispatcher(cmdHandlers);

/**
 * ハンドシェイク 19h をレンダラのスピーカーへ渡す。
 * @param frequencyHz 周波数 Hz（0 で停止）
 * @param durationMs 長さ ms（0 で無限）
 */
function emitBeep(frequencyHz: number, durationMs: number): void {
  parentPort?.postMessage({
    type: "io:beep",
    frequencyHz: frequencyHz & 0xffff,
    durationMs: durationMs & 0xffff,
  });
}

link.setCpuToIoFrameHandler((frame) => {
  // frame[0] は CPU→IO コマンド番号（HandShake.mdc）。
  const cmd = frame[0] ?? 0;
  const response = cmdDispatcher.dispatch(frame);
  if (cmd === CMD_CPU_TO_IO.TIMER_SET) {
    const timerNo = frame[1] ?? 0;
    const state = timerNo === 0 ? intervalTimer.getState() : undefined;
    log.info("タイマー設定を受理 (12h)", {
      timerNo,
      periodMs: state?.periodMs ?? 0,
      count: state?.count ?? 0,
      running: state?.running ?? false,
      status: response[0],
    });
  } else if (cmd === CMD_CPU_TO_IO.LED_DISPLAY) {
    log.info("LED表示 (16h)", {
      status: response[0],
      mode: cmdState.mode,
      bulletLed0_7: frame[0x0d],
      bulletLed8_F: frame[0x0e],
    });
  } else if (cmd === CMD_CPU_TO_IO.BEEP) {
    const beep = cmdState.lastBeep;
    log.info("BEEP (19h)", {
      frequencyHz: beep?.frequencyHz ?? 0,
      durationMs: beep?.durationMs ?? 0,
      status: response[0],
    });
    if (response[0] === 0 && beep) {
      emitBeep(beep.frequencyHz, beep.durationMs);
    }
  } else if (cmd === CMD_CPU_TO_IO.LCD_CTRL || cmd === CMD_CPU_TO_IO.LCD_TEXT) {
    const lcd = getLcdWire();
    log.info("LCD (17h/18h)", {
      cmd: `0x${cmd.toString(16)}`,
      status: response[0],
      kind: cmd === CMD_CPU_TO_IO.LCD_CTRL ? frame[1] : undefined,
      row: cmd === CMD_CPU_TO_IO.LCD_TEXT ? frame[1] : undefined,
      col: cmd === CMD_CPU_TO_IO.LCD_TEXT ? frame[2] : undefined,
      len: cmd === CMD_CPU_TO_IO.LCD_TEXT ? frame[3] : undefined,
      line0: lcd.lines[0],
      line1: lcd.lines[1],
    });
  } else if (cmd === CMD_CPU_TO_IO.UNDEF_NOTIFY) {
    const n = cmdState.lastUndefNotify;
    if (response[0] === 0) {
      consolePanel.setUndefLed(true);
    }
    log.info("未定義命令実行通知 (13h)", {
      status: response[0],
      addr: n?.addr,
      ic: n?.ic,
      npp: n?.npp,
    });
  } else if (cmd === CMD_CPU_TO_IO.RTC_GET_RAW) {
    log.debug("RTC生値取得 (1Ch)", {
      status: response[7],
      regs: Array.from(response.slice(0, 7)),
    });
  } else if (cmd === CMD_CPU_TO_IO.TEMP_GET_RAW) {
    log.debug("温度生値取得 (1Dh)", {
      status: response[2],
      raw: ((response[0] ?? 0) << 8) | (response[1] ?? 0),
    });
  } else if (cmd === CMD_CPU_TO_IO.LIGHT_GET_RAW) {
    log.debug("光生値取得 (1Eh)", {
      status: response[8],
      clear: ((response[0] ?? 0) << 8) | (response[1] ?? 0),
      red: ((response[2] ?? 0) << 8) | (response[3] ?? 0),
      green: ((response[4] ?? 0) << 8) | (response[5] ?? 0),
      blue: ((response[6] ?? 0) << 8) | (response[7] ?? 0),
    });
  } else if (cmd === CMD_CPU_TO_IO.DISTANCE_GET_RAW) {
    log.debug("距離生値取得 (1Fh)", {
      status: response[3],
      distanceMm: ((response[0] ?? 0) << 8) | (response[1] ?? 0),
      rangeStatus: response[2] ?? 0,
    });
  } else {
    log.debug("CPU→IO コマンドを処理", {
      cmd: `0x${cmd.toString(16)}`,
      respLen: response.length,
    });
  }
  return response;
});

/**
 * 共有バッファの実行コードをスナップショット用の文字列に変換する。
 * @returns running / halted / break / idle
 */
function execStatus(): EmuSnapshot["status"] {
  switch (Atomics.load(board.stat, STATUS.EXEC)) {
    case EXEC_CODE.running:
      return "running";
    case EXEC_CODE.halted:
      return "halted";
    case EXEC_CODE.breakpoint:
      return "break";
    default:
      return "idle";
  }
}

/**
 * レンダラへ送る画面用スナップショットを組み立てる。
 * メモリ内容は含めない（RAM は CPU ボード専有のため）。
 * @returns 現在のレジスタ・ピン・LED・パネル状態
 */
function buildSnapshot(): EmuSnapshot {
  const s = board.stat;
  const panel = consolePanel.getState();
  return {
    status: execStatus(),
    regs: {
      R: [
        Atomics.load(s, STATUS.R0) & 0xffff,
        Atomics.load(s, STATUS.R1) & 0xffff,
        Atomics.load(s, STATUS.R2) & 0xffff,
        Atomics.load(s, STATUS.R3) & 0xffff,
        Atomics.load(s, STATUS.R4) & 0xffff,
      ],
      SP: Atomics.load(s, STATUS.SP) & 0xffff,
      STR: Atomics.load(s, STATUS.STR) & 0xffff,
      IC: Atomics.load(s, STATUS.IC) & 0xffff,
      CSBR: Atomics.load(s, STATUS.CSBR) & 0xffff,
      SSBR: Atomics.load(s, STATUS.SSBR) & 0xffff,
      TSR0: Atomics.load(s, STATUS.TSR0) & 0xffff,
      TSR1: Atomics.load(s, STATUS.TSR1) & 0xffff,
      OSR: [
        Atomics.load(s, STATUS.OSR0) & 0xffff,
        Atomics.load(s, STATUS.OSR1) & 0xffff,
        Atomics.load(s, STATUS.OSR2) & 0xffff,
        Atomics.load(s, STATUS.OSR3) & 0xffff,
      ],
      NPP: Atomics.load(s, STATUS.NPP) & 0xffff,
      IISR: Atomics.load(s, STATUS.IISR) & 0xffff,
      SBRB: Atomics.load(s, STATUS.SBRB) & 0xffff,
      ICB: Atomics.load(s, STATUS.ICB) & 0xffff,
    },
    pins: {
      HLT: Atomics.load(s, STATUS.HLT) !== 0,
      RUN: Atomics.load(s, STATUS.RUN) !== 0,
      RST: Atomics.load(s, STATUS.RST) !== 0,
      IRQ0: Atomics.load(s, STATUS.IRQ0) !== 0,
      IRQ1: Atomics.load(s, STATUS.IRQ1) !== 0,
      IRQ2: Atomics.load(s, STATUS.IRQ2) !== 0,
      BSAV: false,
      STRT: false,
      BSRQ: false,
      IOP: false,
      WRT: false,
    },
    memRows: [],
    frame: ioFrame,
    led: getLedDisplayWire(),
    console: panel,
    lcd: getLcdWire(),
    clockCount: clockCountFromHiLo(
      Atomics.load(s, STATUS.CLOCK_HI),
      Atomics.load(s, STATUS.CLOCK_LO),
    ).toString(),
  };
}

/**
 * IO ボードの 1 スライス。ボード処理・CPU 状態の取り込み・スナップショット送信を行う。
 * DMA 中はボード処理を止める。
 */
function slice(): void {
  if (!running) return;
  ioFrame++;

  setCpuToIoRequest(Atomics.load(board.ctrl, CTRL.CPU_TO_IO_REQ) !== 0);

  if (Atomics.load(board.ctrl, CTRL.DMA_BUSY) === 0) {
    tickIoBoard();
  }

  // UNDEF LED は 13h(未定義命令実行通知) / RST が正本（IISR ポーリングでは点灯しない）
  const undefInsn = getUndefLed();
  if (undefInsn !== lastUndefInsn) {
    if (undefInsn) log.warn("未定義命令LED点灯", { via: "13h-undef-notify" });
    lastUndefInsn = undefInsn;
  }

  const status = execStatus();
  const halted = status !== "running";
  consolePanel.syncCpuHalted(halted);
  if (status !== lastExecStatus) {
    log.info("CPU 実行状態が変化", {
      from: lastExecStatus ?? "-",
      to: status,
      ic: Atomics.load(board.stat, STATUS.IC) & 0xffff,
    });
    lastExecStatus = status;
  }

  parentPort?.postMessage({ type: "io:snapshot", snapshot: buildSnapshot() });
  timer = setTimeout(slice, sliceMs);
}

/** スライス実行を開始する（多重呼び出しは無視）。リンク接続後にブートモニタを載せる */
function start(): void {
  if (running) return;
  running = true;
  wallClock.reset();
  Atomics.store(board.ctrl, CTRL.IO_RUNNING, 1);
  consolePanel.refreshLeds();
  timer = setTimeout(slice, sliceMs);
  log.info("IO Worker 開始", { sliceMs });
  parentPort?.postMessage({ type: "io:started" });
  void startDebugHost();
  void runIoBoardReset("power-on").catch((e: unknown) => {
    log.error("電源投入リセットに失敗", {
      err: e instanceof Error ? e.message : String(e),
    });
  });
}

/** スライス実行とタイマー割り込みを止めてタイマーを解除する */
function stop(): void {
  running = false;
  Atomics.store(board.ctrl, CTRL.IO_RUNNING, 0);
  wallClock.stop();
  intervalTimer.stop();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  void stopDebugHost();
  log.info("IO Worker 停止");
  parentPort?.postMessage({ type: "io:stopped" });
}

/**
 * PC（Cursor 拡張）向けデバッグ TCP を 29000 で待つ。
 * 10h/11h/13h/14h は CPU ハンドシェイクの結果を待って返す。
 */
async function startDebugHost(): Promise<void> {
  await stopDebugHost();
  const host = new DebugHost({
    port: init.debugPort,
    handlers: {
      addrBreakSet: (payload) => link.addrBreakSet(payload),
      addrBreakClr: (slot) => link.addrBreakClr(slot),
      memRead: (byteAddr, byteCount) =>
        link.memReadBytes(byteAddr >>> 1, byteCount),
      memWrite: (byteAddr, data) => link.memWriteBytes(byteAddr >>> 1, data),
    },
  });
  debugHost = host;
  try {
    const port = await host.listen();
    log.info("デバッグホスト起動", { port });
  } catch (e: unknown) {
    debugHost = null;
    log.error("デバッグ TCP 待ち受けに失敗", {
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

/** デバッグ TCP を止める */
async function stopDebugHost(): Promise<void> {
  const host = debugHost;
  debugHost = null;
  if (host) await host.close();
}

/**
 * Intel HEX を展開し、記録のある連続区間だけ DMA で CPU RAM へ書く。
 * @param hex Intel HEX テキスト
 * @returns 書き込んだバイト数など（データが無ければ 0）
 */
async function loadHex(hex: string): Promise<{
  bytesWritten: number;
  minAddr: number;
  maxAddr: number;
  chunks: number;
}> {
  log.info("Intel HEX DMA 開始", { hexLength: hex.length });
  const plan = await dmaLoadIntelHex(hex, (byteAddr, data) =>
    link.writeBytes(byteAddr, data),
  );
  if (plan.bytesWritten <= 0) {
    log.warn("Intel HEX に書き込むデータが無い");
    return { bytesWritten: 0, minAddr: 0, maxAddr: -1, chunks: 0 };
  }
  log.info("Intel HEX DMA 完了", {
    bytesWritten: plan.bytesWritten,
    minAddr: plan.minAddr,
    maxAddr: plan.maxAddr,
    chunks: plan.chunks.length,
  });
  return {
    bytesWritten: plan.bytesWritten,
    minAddr: plan.minAddr,
    maxAddr: plan.maxAddr,
    chunks: plan.chunks.length,
  };
}

parentPort?.on(
  "message",
  (msg: {
    type: string;
    port?: MessagePort;
    digit?: string;
    down?: boolean;
    fn?: ConsoleFnKey;
    hex?: string;
    id?: number;
  }) => {
    if (msg?.type === "start") start();
    else if (msg?.type === "stop") stop();
    else if (
      (msg?.type === "link:port" || msg?.type === "dma:port") &&
      msg.port
    ) {
      log.debug("CPU ボードリンクを接続", { type: msg.type });
      link.attach(msg.port);
    } else if (msg?.type === "getSnapshot") {
      parentPort?.postMessage({
        type: "io:snapshot",
        snapshot: buildSnapshot(),
        reply: true,
      });
    } else if (msg?.type === "key:hex" && msg.digit) {
      consolePanel.onHex(msg.digit);
    } else if (msg?.type === "key:hex:hold" && msg.digit) {
      const n = Number.parseInt(msg.digit, 16);
      setHexKeyHeld(cmdState, n, msg.down === true);
    } else if (msg?.type === "key:fn" && msg.fn) {
      const fn = msg.fn;
      void consolePanel.onFunction(fn).catch((e: unknown) => {
        log.error("ファンクションキー処理に失敗", {
          fn,
          err: e instanceof Error ? e.message : String(e),
        });
      });
    } else if (msg?.type === "key:ads:long") {
      consolePanel.onAdsLongPress();
    } else if (
      msg?.type === "mem:loadIntelHex" &&
      typeof msg.hex === "string"
    ) {
      void loadHex(msg.hex)
        .then((r) =>
          parentPort?.postMessage({
            type: "mem:loadIntelHex:result",
            id: msg.id,
            ok: true,
            ...r,
          }),
        )
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          log.error("Intel HEX ロードに失敗", { id: msg.id, err: error });
          parentPort?.postMessage({
            type: "mem:loadIntelHex:result",
            id: msg.id,
            ok: false,
            error,
          });
        });
    }
  },
);

log.info("IO Worker 準備完了");
parentPort?.postMessage({ type: "io:ready" });
