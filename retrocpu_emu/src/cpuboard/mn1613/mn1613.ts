import type { CpuPins } from "./mn1613pin";
import {
  clearDeferred,
  commitSample,
  createInputPin,
  createOutputPin,
  risingEdge,
  setInputLevel,
  setOutputLevel,
  takeDeferred,
  type InputPin,
  type OutputPin,
} from "../pin_signal";
import { addrComparators } from "./addr_comparator";
import { stepBreak } from "./step_break";

/**
 * Panasonic MN1610 / MN1613 CPU Emulator Core
 *
 * 参照文書: .github/MN1610.md / .github/MN1613.md
 *
 * アーキテクチャ:
 *   - 16bit ワードマシン（ワードアドレス指定、ビッグエンディアン）
 *   - 汎用レジスタ: R0〜R4（16bit）、X0=R3、X1=R4
 *   - スタックポインタ: SP（16bit）
 *   - ステータスレジスタ: STR（16bit）
 *       bit15(MSB)=E、bit13=OVF、bit10=M0、bit9=M1、bit8=M2、bit7〜0=Pk
 *   - 命令カウンタ: IC（16bit、他CPUのPCに相当）
 *   - セグメントベースレジスタ（MN1613）: CSBR/SSBR/TSR0/TSR1（各4bit）
 *   - OS レジスタ: OSR0〜OSR3（割り込み時 CSBR 退避用）
 *   - 特殊レジスタ: NPP/IISR/SBRB/ICB
 *
 * 物理アドレス: (SegReg & 0xF) << 14 + LogAddr → 18bit（桁上がり無視）
 *
 * 公開 API:
 *   setMemory(buf) / getMemory()
 *   powerOnIdle() / reset() / getState() / setState() / getExecStatus()
 *   getClockCount()
 *   step() / run(startAddr, maxCycles?) / halt()
 *   addBreakpoint / removeBreakpoint / clearBreakpoints / getBreakpoints
 *   setStepMode(enable)
 *   setOnStopCallback(cb)
 *   setOnBeforeExecute(cb) / setOnAfterExecute(cb)  ※テスト専用。通常は null
 *   setIoReadCallback(cb) / setIoWriteCallback(cb)
 *   triggerInterrupt(level)
 */

// ─────────────────────────────────────────────
// メモリ（外部から setMemory() で渡す）
// デフォルト: 256K ワード = 512KB（MN1613 フル物理空間）
// CSBR=0 なら 0〜0xFFFF のみ使用（MN1610 互換）
// ─────────────────────────────────────────────
const MEM_WORDS = 0x40000; // 256K words
let _memory: ArrayBufferLike = new ArrayBuffer(MEM_WORDS * 2);
let _memView: DataView = new DataView(_memory);
/** IO ポートごとの直近書込値（WRITE ブレイクの 0034 用 BEFORE） */
const _ioLastWrite = new Map<number, number>();

/** SharedArrayBuffer 可（CPU / IO ワーカ間で RAM を共有するとき） */
export function setMemory(buf: ArrayBufferLike): void {
  _memory = buf;
  _memView = new DataView(_memory);
}

/**
 * 現在 CPU が使っているメモリバッファを返す。
 * @returns setMemory() で差し替えた ArrayBuffer / SharedArrayBuffer
 */
export function getMemory(): ArrayBufferLike {
  return _memory;
}

// ─────────────────────────────────────────────
// STR ビット定義
// MN1610 の bit0=MSB 記法 → JS の bit15=MSB に変換
// ─────────────────────────────────────────────
/** E フラグ（拡張／キャリー）: MN1610 bit0 */
export const STR_E = 0x8000;
/** OVF フラグ（オーバーフロー）: MN1610 bit2 */
export const STR_OVF = 0x2000;
/** M0（割り込みマスク level0）: MN1610 bit5 */
export const STR_M0 = 0x0400;
/** M1（割り込みマスク level1）: MN1610 bit6 */
export const STR_M1 = 0x0200;
/** M2（割り込みマスク level2）: MN1610 bit7 */
export const STR_M2 = 0x0100;

// ─────────────────────────────────────────────
// CPU レジスタ
// ─────────────────────────────────────────────
export type CPURegister = {
  /** 汎用レジスタ R0〜R4（index 0〜4） */
  R: [number, number, number, number, number];
  SP: number;
  STR: number;
  /** 命令カウンタ（PC に相当） */
  IC: number;
  CSBR: number;
  SSBR: number;
  TSR0: number;
  TSR1: number;
  /** OS レジスタ（割り込み時 CSBR 退避）OSR0〜OSR3 */
  OSR: [number, number, number, number];
  /** New PSW Pointer（上位 8bit 有効、リセット時=1） */
  NPP: number;
  IISR: number;
  SBRB: number;
  ICB: number;
};
// ─────────────────────────────────────────────
// CPU レジスタ
// ─────────────────────────────────────────────
let cpuRegister: CPURegister = {
  R: [0, 0, 0, 0, 0],
  SP: 0,
  STR: 0,
  IC: 0,
  CSBR: 0,
  SSBR: 0,
  TSR0: 0,
  TSR1: 0,
  OSR: [0, 0, 0, 0],
  // NPP は下位8bitの値（0〜0xff）として保持し、IRQ 受理時に <<8 して NPSW 先頭（ワードアドレス）を作る。
  NPP: 0x01,
  IISR: 0,
  SBRB: 0,
  ICB: 0,
};

// ─────────────────────────────────────────────
// 実行状態
// ─────────────────────────────────────────────
export type ExecStatus = "idle" | "running" | "step" | "break" | "halted";

// ─────────────────────────────────────────────
// 実行制御
// ─────────────────────────────────────────────
let _execStatus: ExecStatus = "idle";
const _breakpoints = new Set<number>();
let _stepMode = false;
let _pendingIRQ = 0;

/**
 * リセットからの CPU クロック（64bit）。
 * 根拠: MN1613.mdc clk 欄（13.3 MHz・DTAK 即応答の推測。メモリアクセス 1 回 = 4 clk）。
 * HALT / idle 中は進まない。DMA は CPU バスサイクルではないので数えない。
 */
let _clockCount = 0n;

/** 1 メモリアクセス（フェッチ／オペランド R/W／IO）あたりのクロック */
export const CPU_CLK_PER_ACCESS = 4;

const CLOCK_U64 = 0xffff_ffff_ffff_ffffn;

/**
 * CPU クロックを加算する（64bit でラップ）。
 * @param n 加算するクロック数（正の整数）
 */
function _addClocks(n: number): void {
  if (n <= 0) return;
  _clockCount = (_clockCount + BigInt(n)) & CLOCK_U64;
}

export type OnStopCallback = (status: ExecStatus, state: CPURegister) => void;
/**
 * 1 命令フェッチ直前（IRQ 処理後）のトレース。テスト専用。
 * 通常のエミュレータ実行では登録しない（速度低下回避）。
 */
export type OnBeforeExecuteCallback = (state: CPURegister) => void;
/** 1 命令実行直後のトレース。テスト専用。 */
export type OnAfterExecuteCallback = (state: CPURegister) => void;
export type IoReadCallback = (port: number) => number;
export type IoWriteCallback = (port: number, val: number) => void;

let _onStop: OnStopCallback | null = null;
let _onBeforeExecute: OnBeforeExecuteCallback | null = null;
let _onAfterExecute: OnAfterExecuteCallback | null = null;
let _ioRead: IoReadCallback = (_p) => 0xffff;
let _ioWrite: IoWriteCallback = (_p, _v) => {
  /* nop */
};

// ─────────────────────────────────────────────
// ピン状態（retrocpu_emu.mdc: 入力 boolean[3] / 出力 boolean[2]）
// ─────────────────────────────────────────────
const _pinRST: InputPin = createInputPin(false);
const _pinHLT: InputPin = createInputPin(false);
const _pinIRQ0: InputPin = createInputPin(false);
const _pinIRQ1: InputPin = createInputPin(false);
const _pinIRQ2: InputPin = createInputPin(false);
const _pinBSAV: InputPin = createInputPin(false);
const _pinSTRT: InputPin = createInputPin(false);
const _pinIOP: OutputPin = createOutputPin(false);
const _pinBSRQ: OutputPin = createOutputPin(false);
const _pinWRT: OutputPin = createOutputPin(false);

const _inputPins: InputPin[] = [
  _pinRST,
  _pinHLT,
  _pinIRQ0,
  _pinIRQ1,
  _pinIRQ2,
  _pinBSAV,
  _pinSTRT,
];
const _outputPins: OutputPin[] = [_pinIOP, _pinBSRQ, _pinWRT];

// ─────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────

/**
 * 電源投入直後相当: レジスタ初期化のみ行い、実行はしない（リセット待ち）。
 * IO:0 は読まない。RST パルス（reset）でベクタ表を読んで実行開始する。
 */
export function powerOnIdle(): void {
  cpuRegister = {
    R: [0, 0, 0, 0, 0],
    SP: 0,
    STR: 0,
    IC: 0,
    CSBR: 0,
    SSBR: 0,
    TSR0: 0,
    TSR1: 0,
    OSR: [0, 0, 0, 0],
    // NPP は下位8bitの値（0〜0xff）
    NPP: 0x01,
    IISR: 0,
    SBRB: 0,
    ICB: 0,
  };
  _execStatus = "idle";
  _stepMode = false;
  _pendingIRQ = 0;
  _clockCount = 0n;
  for (const p of _inputPins) {
    clearDeferred(p);
    p[1] = p[0];
  }
  for (const p of _outputPins) {
    setOutputLevel(p, false);
    p[1] = false;
  }
  _ioLastWrite.clear();
}

/**
 * CPU をリセットする（MN1613.mdc）。
 * IO:0 を読み、その値+2 のメモリ → STR、+3 のメモリ → IC。NPP=1 で実行開始。
 */
export function reset(): void {
  cpuRegister = {
    R: [0, 0, 0, 0, 0],
    SP: 0,
    STR: 0,
    IC: 0,
    CSBR: 0,
    SSBR: 0,
    TSR0: 0,
    TSR1: 0,
    OSR: [0, 0, 0, 0],
    // NPP は下位8bitの値（0〜0xff）
    NPP: 0x01,
    IISR: 0,
    SBRB: 0,
    ICB: 0,
  };
  _stepMode = false;
  _pendingIRQ = 0;
  _ioLastWrite.clear();
  // 入力 [0] は外部駆動のまま残し、エッジ再発火を防ぐため [1] を同期
  for (const p of _inputPins) {
    clearDeferred(p);
    p[1] = p[0];
  }
  for (const p of _outputPins) {
    setOutputLevel(p, false);
    p[1] = false;
  }
  // MN1613: IO:0 → ベクタ表先頭。mem[先頭+2]=STR、mem[先頭+3]=IC
  const vec = _ioRead(0) & 0xffff;
  cpuRegister.STR = _peekWord(vec + 2);
  cpuRegister.IC = _peekWord(vec + 3);
  _clockCount = 0n;
  _execStatus = "running";
}

/**
 * 入力ピンの現在値 [0] だけを設定する（外部から触れるのはここだけ）。
 * エッジ処理・保留処理は processInputPins() / tickCpu() 側。
 */
export function setPins(pins: Partial<CpuPins>): void {
  if (pins.RST !== undefined) setInputLevel(_pinRST, pins.RST);
  if (pins.HLT !== undefined) setInputLevel(_pinHLT, pins.HLT);
  if (pins.IRQ0 !== undefined) setInputLevel(_pinIRQ0, pins.IRQ0);
  if (pins.IRQ1 !== undefined) setInputLevel(_pinIRQ1, pins.IRQ1);
  if (pins.IRQ2 !== undefined) setInputLevel(_pinIRQ2, pins.IRQ2);
  if (pins.BSAV !== undefined) setInputLevel(_pinBSAV, pins.BSAV);
  if (pins.STRT !== undefined) setInputLevel(_pinSTRT, pins.STRT);
  // 互換: 設定直後にサンプル処理（単体テスト・UIパルス用）
  processInputPins();
}

/**
 * 入力ピンを1サンプル処理する（仕様ループ 1-1〜1-3）。
 * - RST 立ち上がり / 保留 → reset()
 * - HLT アサート → halted
 * - IRQ 立ち上がり / 保留 → pending（マスクは _handleIRQ 側）
 */
export function processInputPins(): void {
  if (risingEdge(_pinRST) || takeDeferred(_pinRST)) {
    reset();
  }

  if (_pinHLT[0] || takeDeferred(_pinHLT)) {
    if (_execStatus === "running") {
      _execStatus = "halted";
      _onStop?.("halted", getState());
    }
  }

  const irqPins = [_pinIRQ0, _pinIRQ1, _pinIRQ2] as const;
  for (let lv = 0; lv < 3; lv++) {
    const pin = irqPins[lv]!;
    if (risingEdge(pin) || takeDeferred(pin)) {
      _pendingIRQ |= 1 << lv;
    }
  }

  for (const p of _inputPins) {
    commitSample(p);
  }
  for (const p of _outputPins) {
    commitSample(p);
  }
}

/**
 * 現在のピン状態スナップショットを返す。
 * 入力は [0]、RUN は実行状態から生成。
 */
export function getPins(): CpuPins {
  return {
    HLT: _pinHLT[0],
    RUN: _execStatus === "running",
    IRQ0: _pinIRQ0[0],
    IRQ1: _pinIRQ1[0],
    IRQ2: _pinIRQ2[0],
    RST: _pinRST[0],
    BSAV: _pinBSAV[0],
    STRT: _pinSTRT[0],
    IOP: _pinIOP[0],
    BSRQ: _pinBSRQ[0],
    WRT: _pinWRT[0],
  };
}

/**
 * マスクが有効なペンディング割り込みがあるか。
 * H 命令による停止から起きる判定に使う（HLT ピンは別）。
 * @returns 受け付け可能な IRQ があれば true
 */
function hasAcceptableIrq(): boolean {
  for (let lv = 0; lv <= 2; lv++) {
    const mask = [STR_M0, STR_M1, STR_M2][lv]!;
    if ((_pendingIRQ & (1 << lv)) !== 0 && (cpuRegister.STR & mask) !== 0) {
      return true;
    }
  }
  return false;
}

/** メインループ用: ピン監視 → 実行中なら1命令 */
export function tickCpu(): void {
  processInputPins();
  if (_pinHLT[0] || _execStatus === "idle") {
    return;
  }
  if (_execStatus === "halted") {
    if (!hasAcceptableIrq()) return;
    _execStatus = "running";
  }
  if (_execStatus === "break" || _execStatus === "step") {
    return;
  }
  if (_breakpoints.has(cpuRegister.IC)) {
    _execStatus = "break";
    _onStop?.("break", getState());
    return;
  }
  setOutputLevel(_pinIOP, false);
  setOutputLevel(_pinWRT, false);
  _executeOne();
}

/** UI の RUN: 現在 IC から連続実行モードへ */
export function startRun(): void {
  if (_pinHLT[0]) return;
  _stepMode = false;
  _execStatus = "running";
}

/** UI の HALT 要求（ピンではなく実行状態） */
export function requestHalt(): void {
  if (_execStatus === "running") {
    _execStatus = "halted";
    _onStop?.("halted", getState());
  }
}

/** CPU 状態スナップショットを返す */
export function getState(): CPURegister {
  // CPU レジスタをディープコピーして返す
  return JSON.parse(JSON.stringify(cpuRegister));
}

/**
 * リセット以降の CPU クロック数を返す（64bit、2^64 でラップ）。
 * @returns 0 以上。powerOnIdle / reset 直後は 0
 */
export function getClockCount(): bigint {
  return _clockCount;
}

/**
 * テスト／デバッガ用: レジスタを部分更新する。
 * 未指定フィールドは維持。R は指定インデックスのみ上書き。
 */
export function setState(
  partial: Partial<Omit<CPURegister, "R" | "OSR">> & {
    R?: Partial<CPURegister["R"]> | number[];
    OSR?: Partial<CPURegister["OSR"]> | number[];
  },
): void {
  if (partial.R) {
    const r = partial.R;
    for (let i = 0; i < 5; i++) {
      const v = (r as number[])[i];
      if (v !== undefined) cpuRegister.R[i] = v & 0xffff;
    }
  }
  if (partial.OSR) {
    const o = partial.OSR;
    for (let i = 0; i < 4; i++) {
      const v = (o as number[])[i];
      if (v !== undefined) cpuRegister.OSR[i] = v & 0xffff;
    }
  }
  if (partial.SP !== undefined) cpuRegister.SP = partial.SP & 0xffff;
  if (partial.STR !== undefined) cpuRegister.STR = partial.STR & 0xffff;
  if (partial.IC !== undefined) cpuRegister.IC = partial.IC & 0xffff;
  if (partial.CSBR !== undefined) cpuRegister.CSBR = partial.CSBR & 0xf;
  if (partial.SSBR !== undefined) cpuRegister.SSBR = partial.SSBR & 0xf;
  if (partial.TSR0 !== undefined) cpuRegister.TSR0 = partial.TSR0 & 0xf;
  if (partial.TSR1 !== undefined) cpuRegister.TSR1 = partial.TSR1 & 0xf;
  if (partial.NPP !== undefined) cpuRegister.NPP = partial.NPP & 0xff;
  if (partial.IISR !== undefined) cpuRegister.IISR = partial.IISR & 0xffff;
  if (partial.SBRB !== undefined) cpuRegister.SBRB = partial.SBRB & 0xffff;
  if (partial.ICB !== undefined) cpuRegister.ICB = partial.ICB & 0xffff;
}

/**
 * 現在の実行状態を返す。
 * @returns running / step / break / halted
 */
export function getExecStatus(): ExecStatus {
  return _execStatus;
}

/**
 * 命令ブレイクポイントを追加する。
 * @param addr ワードアドレス（下位 16bit のみ有効）
 */
export function addBreakpoint(addr: number): void {
  _breakpoints.add(addr & 0xffff);
}

/**
 * 命令ブレイクポイントを 1 つ解除する。
 * @param addr 追加時と同じワードアドレス
 */
export function removeBreakpoint(addr: number): void {
  _breakpoints.delete(addr & 0xffff);
}

/** 命令ブレイクポイントを全て解除する */
export function clearBreakpoints(): void {
  _breakpoints.clear();
}

/**
 * 設定済みの命令ブレイクポイント一覧を返す。
 * @returns 内部 Set の読み取り専用ビュー（コピーではない）
 */
export function getBreakpoints(): ReadonlySet<number> {
  return _breakpoints;
}

/**
 * ステップ実行モードを切り替える。
 * 実行中に有効化すると次の命令境界で停止する。
 * @param enable true でステップモード
 */
export function setStepMode(enable: boolean): void {
  _stepMode = enable;
  if (enable && _execStatus === "running") _execStatus = "step";
}

/**
 * 停止（break / halted / step）時に呼ばれるコールバックを登録する。
 * @param cb コールバック。null で解除
 */
export function setOnStopCallback(cb: OnStopCallback | null): void {
  _onStop = cb;
}

/**
 * 命令フェッチ直前のトレースフックを登録する（テスト専用 CPU ログ用）。
 * `run` / `step` / `tickCpu` の実行経路で呼ばれる。null なら何もしない（通常実行）。
 * @param cb コールバック。null で解除
 */
export function setOnBeforeExecute(cb: OnBeforeExecuteCallback | null): void {
  _onBeforeExecute = cb;
}

/**
 * 命令実行直後のトレースフックを登録する（テスト専用 CPU ログ用）。
 * null なら何もしない（通常実行）。
 * @param cb コールバック。null で解除
 */
export function setOnAfterExecute(cb: OnAfterExecuteCallback | null): void {
  _onAfterExecute = cb;
}

/**
 * IN 命令のリードを外部へ委譲するコールバックを登録する。
 * @param cb ポート番号を受け取り 16bit 値を返す関数
 */
export function setIoReadCallback(cb: IoReadCallback): void {
  _ioRead = cb;
}

/**
 * OUT 命令のライトを外部へ委譲するコールバックを登録する。
 * @param cb ポート番号と 16bit 値を受け取る関数
 */
export function setIoWriteCallback(cb: IoWriteCallback): void {
  _ioWrite = cb;
}

/** 割り込みペンディングマスク（デバッグ／テスト用） */
export function getPendingIrq(): number {
  return _pendingIRQ;
}

/** 割り込み要求（level 0〜2）。対応する Mx ビットが有効な場合のみ受け付ける */
export function triggerInterrupt(level: 0 | 1 | 2): void {
  _pendingIRQ |= 1 << level;
}

/** 1命令実行して CPU 状態を返す */
export function step(): CPURegister {
  if (_pinHLT[0]) return getState();
  if (_execStatus === "halted") {
    if (!hasAcceptableIrq()) return getState();
    _execStatus = "running";
  }
  _stepMode = false;
  _execStatus = "running" as ExecStatus;
  setOutputLevel(_pinIOP, false);
  setOutputLevel(_pinWRT, false);
  _executeOne();
  if ((_execStatus as ExecStatus) !== "halted") {
    _execStatus = "step";
    _onStop?.(_execStatus, getState());
  }
  return getState();
}

/**
 * 指定アドレスから連続実行。
 * ブレークポイント / HALT / setStepMode(true) で停止。
 * @param startAddr 開始ワードアドレス
 * @param maxCycles 最大サイクル数（0=無制限）
 */
export async function run(
  startAddr: number,
  maxCycles = 0,
): Promise<ExecStatus> {
  cpuRegister.IC = startAddr & 0xffff;
  _execStatus = "running";
  _stepMode = false;

  return new Promise<ExecStatus>((resolve) => {
    let cycles = 0;
    const BATCH = 1000;

    /** BATCH 命令ずつ実行し、停止条件に当たるまで setTimeout で継続する */
    function tick(): void {
      for (let i = 0; i < BATCH; i++) {
        // HLT ピンによる停止チェック
        if (_pinHLT[0]) {
          _execStatus = "halted";
          _onStop?.(_execStatus, getState());
          resolve(_execStatus);
          return;
        }
        if (_breakpoints.has(cpuRegister.IC)) {
          _execStatus = "break";
          _onStop?.(_execStatus, getState());
          resolve(_execStatus);
          return;
        }
        if (_stepMode) {
          _execStatus = "step";
          _onStop?.(_execStatus, getState());
          resolve(_execStatus);
          return;
        }
        setOutputLevel(_pinIOP, false);
        setOutputLevel(_pinWRT, false);
        _executeOne();
        if (_execStatus === "halted") {
          _onStop?.(_execStatus, getState());
          resolve(_execStatus);
          return;
        }
        if (maxCycles > 0 && ++cycles >= maxCycles) {
          _execStatus = "break";
          _onStop?.(_execStatus, getState());
          resolve(_execStatus);
          return;
        }
      }
      setTimeout(tick, 0);
    }
    setTimeout(tick, 0);
  });
}

/** 実行を強制停止 */
export function halt(): void {
  _execStatus = "halted";
}

// ─────────────────────────────────────────────
// I/O アクセスラッパー（IOP フラグを自動セット）
// ─────────────────────────────────────────────
/**
 * I/O リード（IOP=H / WRT=L を出しつつコールバックを呼ぶ）。
 * アクセス後に CPLD 比較器へ通知する（一致時 INT2・要因3）。
 * @param port ポート番号
 * @returns 読み取った 16bit 値
 */
function _doIoRead(port: number): number {
  setOutputLevel(_pinIOP, true);
  setOutputLevel(_pinWRT, false);
  _addClocks(CPU_CLK_PER_ACCESS);
  const v = _ioRead(port);
  addrComparators.probe({ addr: port & 0xffff, io: true, write: false });
  return v;
}

/**
 * I/O ライト（IOP=H / WRT=H を出しつつコールバックを呼ぶ）。
 * アクセス後に CPLD 比較器へ通知する（一致時 INT2・要因3）。
 * @param port ポート番号
 * @param val 書き込む 16bit 値
 */
function _doIoWrite(port: number, val: number): void {
  setOutputLevel(_pinIOP, true);
  setOutputLevel(_pinWRT, true);
  _addClocks(CPU_CLK_PER_ACCESS);
  const p = port & 0xffff;
  const prev = _ioLastWrite.get(p) ?? 0;
  const after = val & 0xffff;
  _ioWrite(p, after);
  _ioLastWrite.set(p, after);
  addrComparators.probe({
    addr: p,
    io: true,
    write: true,
    data: after,
    prev,
  });
}

// ─────────────────────────────────────────────
// 物理アドレス計算
// physical = (segReg & 0xF) << 14 + logical  (18bit、桁上がり無視)
// ─────────────────────────────────────────────
/**
 * 論理アドレスとセグメントから 18bit 物理ワードアドレスを求める。
 * @param logAddr 論理ワードアドレス（16bit）
 * @param seg セグメントレジスタ値（下位 4bit）
 * @returns 物理ワードアドレス（桁上がりは捨てる）
 */
function _phys(logAddr: number, seg: number): number {
  return (((seg & 0xf) << 14) + (logAddr & 0xffff)) & 0x3ffff;
}

/**
 * リセット用に CSBR=0 の論理ワードを読む（クロック・比較器は動かさない）。
 * @param logAddr 論理ワードアドレス（16bit）
 * @returns 16bit 値。範囲外は 0xFFFF
 */
function _peekWord(logAddr: number): number {
  const b = _phys(logAddr & 0xffff, 0) * 2;
  return b + 1 >= _memView.byteLength ? 0xffff : _memView.getUint16(b, false);
}

// ─────────────────────────────────────────────
// メモリアクセス（ビッグエンディアン）
// ─────────────────────────────────────────────
/**
 * 物理アドレスから 1 ワード読む。
 * アクセス後に CPLD 比較器へ通知する（一致時 INT2・要因3）。
 * @param phys 物理ワードアドレス
 * @returns 16bit 値。メモリ範囲外は 0xFFFF
 */
function _rdPhys(phys: number): number {
  _addClocks(CPU_CLK_PER_ACCESS);
  const p = phys & 0x3ffff;
  const b = p * 2;
  const v = b + 1 >= _memView.byteLength ? 0xffff : _memView.getUint16(b, false);
  addrComparators.probe({ addr: p, io: false, write: false });
  return v;
}

/**
 * 物理アドレスへ 1 ワード書く。範囲外は無視する。
 * アクセス後に CPLD 比較器へ通知する（一致時 INT2・要因3）。
 * @param phys 物理ワードアドレス
 * @param val 16bit 値
 */
function _wrPhys(phys: number, val: number): void {
  _addClocks(CPU_CLK_PER_ACCESS);
  const p = phys & 0x3ffff;
  const b = p * 2;
  const after = val & 0xffff;
  const prev =
    b + 1 >= _memView.byteLength ? 0xffff : _memView.getUint16(b, false);
  if (b + 1 < _memView.byteLength) {
    _memView.setUint16(b, after, false);
  }
  addrComparators.probe({
    addr: p,
    io: false,
    write: true,
    data: after,
    prev,
  });
}

/**
 * コードセグメント（CSBR）からの読み出し。
 * @param la 論理ワードアドレス
 * @returns 16bit 値
 */
function _rdC(la: number): number {
  return _rdPhys(_phys(la, cpuRegister.CSBR));
}

/**
 * コードセグメント（CSBR）への書き込み。
 * @param la 論理ワードアドレス
 * @param v 16bit 値
 */
function _wrC(la: number, v: number): void {
  _wrPhys(_phys(la, cpuRegister.CSBR), v);
}

/**
 * スタックセグメント（SSBR）からの読み出し。
 * @param la 論理ワードアドレス
 * @returns 16bit 値
 */
function _rdS(la: number): number {
  return _rdPhys(_phys(la, cpuRegister.SSBR));
}

/**
 * スタックセグメント（SSBR）への書き込み。
 * @param la 論理ワードアドレス
 * @param v 16bit 値
 */
function _wrS(la: number, v: number): void {
  _wrPhys(_phys(la, cpuRegister.SSBR), v);
}

/**
 * 任意セグメント指定での読み出し（TSR0/TSR1 等）。
 * @param la 論理ワードアドレス
 * @param seg セグメント値（下位 4bit）
 * @returns 16bit 値
 */
function _rdB(la: number, seg: number): number {
  return _rdPhys(_phys(la, seg));
}

/**
 * 任意セグメント指定での書き込み（TSR0/TSR1 等）。
 * @param la 論理ワードアドレス
 * @param v 16bit 値
 * @param seg セグメント値（下位 4bit）
 */
function _wrB(la: number, v: number, seg: number): void {
  _wrPhys(_phys(la, seg), v);
}

/** IC をインクリメントして次の語をフェッチ（CSBR セグメント） */
function _fetch(): number {
  const w = _rdC(cpuRegister.IC);
  cpuRegister.IC = (cpuRegister.IC + 1) & 0xffff;
  return w;
}

// ─────────────────────────────────────────────
// レジスタアクセス
// RRR: 0=R0 1=R1 2=R2 3=R3/X0 4=R4/X1 5=SP 6=STR 7=IC
// ─────────────────────────────────────────────
/**
 * RRR フィールドが指すレジスタを読む。
 * @param rrr 0=R0 1=R1 2=R2 3=R3/X0 4=R4/X1 5=SP 6=STR 7=IC
 * @returns 16bit 値
 */
function _gr(rrr: number): number {
  switch (rrr & 7) {
    case 0:
      return cpuRegister.R[0];
    case 1:
      return cpuRegister.R[1];
    case 2:
      return cpuRegister.R[2];
    case 3:
      return cpuRegister.R[3];
    case 4:
      return cpuRegister.R[4];
    case 5:
      return cpuRegister.SP;
    case 6:
      return cpuRegister.STR;
    default:
      return cpuRegister.IC;
  }
}

/**
 * RRR フィールドが指すレジスタへ書く。
 * @param rrr 0=R0 1=R1 2=R2 3=R3/X0 4=R4/X1 5=SP 6=STR 7=IC
 * @param v 16bit 値（上位は切り捨て）
 */
function _sw(rrr: number, v: number): void {
  v &= 0xffff;
  switch (rrr & 7) {
    case 0:
      cpuRegister.R[0] = v;
      break;
    case 1:
      cpuRegister.R[1] = v;
      break;
    case 2:
      cpuRegister.R[2] = v;
      break;
    case 3:
      cpuRegister.R[3] = v;
      break;
    case 4:
      cpuRegister.R[4] = v;
      break;
    case 5:
      cpuRegister.SP = v;
      break;
    case 6:
      cpuRegister.STR = v;
      break;
    default:
      cpuRegister.IC = v;
      break;
  }
}

/** ii フィールド（0〜3）→ R1〜R4 の値 */
function _ri(ii: number): number {
  return cpuRegister.R[(ii & 3) + 1];
}
/**
 * ii フィールドが指すレジスタ（R1〜R4）へ書く。
 * @param ii 0〜3（R1〜R4 に対応）
 * @param v 16bit 値
 */
function _riSet(ii: number, v: number): void {
  cpuRegister.R[(ii & 3) + 1] = v & 0xffff;
}

/** BB フィールド（0〜3）→ セグメントレジスタ値 */
function _seg(bb: number): number {
  switch (bb & 3) {
    case 0:
      return cpuRegister.CSBR;
    case 1:
      return cpuRegister.SSBR;
    case 2:
      return cpuRegister.TSR0;
    default:
      return cpuRegister.TSR1;
  }
}

// ─────────────────────────────────────────────
// 実効アドレス計算（MN1610 互換 8 モード）
// 相対の (IC) は当該命令自身のアドレス（次命令ではない）
// ─────────────────────────────────────────────
/**
 * 実効アドレスを計算する（MN1610 互換 8 モード）。
 * フェッチ後の IC は次命令位置なので、相対は IC-1（当該命令）+ d。
 * @param mmm アドレッシングモード 0〜7
 * @param d ディスプレースメント（8bit。相対モードでは符号付き）
 * @returns 論理ワードアドレス（16bit）
 */
function _ea(mmm: number, d: number): number {
  const sd = d < 0x80 ? d : d - 0x100; // 符号付き 8bit
  const insnIc = (cpuRegister.IC - 1) & 0xffff;
  switch (mmm & 7) {
    case 0:
      return d & 0xff;
    case 1:
      return (insnIc + sd) & 0xffff;
    case 2:
      return _rdC(d & 0xff);
    case 3:
      return _rdC((insnIc + sd) & 0xffff);
    case 4:
      return (cpuRegister.R[3] + (d & 0xff)) & 0xffff;
    case 5:
      return (cpuRegister.R[4] + (d & 0xff)) & 0xffff;
    case 6:
      return (cpuRegister.R[3] + _rdC(d & 0xff)) & 0xffff;
    default:
      return (cpuRegister.R[4] + _rdC(d & 0xff)) & 0xffff;
  }
}

// ─────────────────────────────────────────────
// スキップ条件評価（kkkk: 4bit スキップコード）
// result: 演算結果（16bit）
// ─────────────────────────────────────────────
/**
 * スキップ条件を評価する。
 * @param kkkk 4bit スキップコード
 * @param result 判定対象の演算結果（16bit）
 * @returns true なら次命令をスキップする
 */
function _skip(kkkk: number, result: number): boolean {
  const n = (result & 0x8000) !== 0;
  const z = (result & 0xffff) === 0;
  const e = (cpuRegister.STR & STR_E) !== 0;
  const v = (cpuRegister.STR & STR_OVF) !== 0;
  switch (kkkk & 0xf) {
    case 0x0:
      return false;
    case 0x1:
      return true;
    case 0x2:
      return n;
    case 0x3:
      return !n;
    case 0x4:
      return z;
    case 0x5:
      return !z;
    case 0x6:
      return n || z;
    case 0x7:
      return !n && !z;
    case 0x8:
      return !e;
    case 0x9:
      return e;
    case 0xa:
      return !v;
    case 0xb:
      return v;
    case 0xc:
      return e || z;
    case 0xd:
      return !e && !z;
    case 0xe:
      return !e;
    default:
      return e && !z;
  }
}

/** 次の命令を読み飛ばす（2語命令も正しくスキップ） */
function _skipNext(): void {
  const ir = _rdC(cpuRegister.IC);
  cpuRegister.IC = (cpuRegister.IC + 1) & 0xffff;
  if (_is2Word(ir)) cpuRegister.IC = (cpuRegister.IC + 1) & 0xffff;
}

/** 命令語が 2語命令か判定 */
function _is2Word(ir: number): boolean {
  const op = (ir >>> 11) & 0x1f;
  const rrr = (ir >>> 8) & 0x7;
  const lo = ir & 0xff;
  const b10 = lo & 0xf; // 下位ニブル

  switch (op) {
    case 0x01:
      return rrr === 7 && (lo & 7) === 7; // LB/LS/STB/STS
    case 0x02:
      return rrr === 7 && lo !== 0x0f && lo !== 0x07; // TSET/TRST
    case 0x04:
      if (rrr === 7 && lo & 0x08 && !(lo & 0x40)) return true; // LD/BL/BALL
      if (rrr === 7 && lo & 0x08 && lo & 0x40) return true; // STD
      if (rrr === 6 && (lo === 0x07 || lo === 0x17)) return true; // BD/BALD
      return false;
    case 0x08:
    case 0x09:
      return rrr === 7 && (lo & 0x04) !== 0; // SD/AD
    case 0x0a:
    case 0x0b:
    case 0x0c:
    case 0x0d:
      return rrr !== 7 && (b10 === 0xf || b10 === 0x7);
    case 0x0f:
      return b10 === 0x7; // MVWI
    default:
      return false;
  }
}

// ─────────────────────────────────────────────
// フラグ更新ヘルパー
// ─────────────────────────────────────────────
/**
 * STR の E（拡張／キャリー）フラグを設定する。
 * @param v true で 1、false で 0
 */
function _setE(v: boolean): void {
  if (v) cpuRegister.STR |= STR_E;
  else cpuRegister.STR &= ~STR_E & 0xffff;
}

/**
 * STR の OVF（オーバーフロー）フラグを設定する。
 * @param v true で 1、false で 0
 */
function _setOVF(v: boolean): void {
  if (v) cpuRegister.STR |= STR_OVF;
  else cpuRegister.STR &= ~STR_OVF & 0xffff;
}

/** 加算（16bit）: E=桁上がり、OVF=符号付きオーバーフロー */
function _add(a: number, b: number): number {
  const res = a + b;
  _setE(res > 0xffff);
  _setOVF((~(a ^ b) & (a ^ res) & 0x8000) !== 0);
  return res & 0xffff;
}

/** 減算（16bit）: E=借り、OVF=符号付きオーバーフロー */
function _sub(a: number, b: number): number {
  const res = a - b;
  _setE(res < 0);
  _setOVF(((a ^ b) & (a ^ res) & 0x8000) !== 0);
  return res & 0xffff;
}

/** EE フィールド処理（SR/SL 前の E レジスタ操作）
 *  EE: 00=変化なし 01=RE(E←0) 10=SE(E←1) 11=CE(E←~E)
 */
function _applyEE(ee: number): void {
  switch (ee & 3) {
    case 1:
      _setE(false);
      break;
    case 2:
      _setE(true);
      break;
    case 3:
      _setE((cpuRegister.STR & STR_E) === 0);
      break;
  }
}

// ─────────────────────────────────────────────
// PUSH / POP（SSBR セグメント）
// SP は常に空きスロットを指す
// PUSH: 現在 SP に書く → SP を下げる
// POP:  SP を上げる → 読む
// ─────────────────────────────────────────────
/**
 * スタックへ 1 ワード積む（SSBR セグメント）。SP は空きスロットを指す。
 * @param v 積む 16bit 値
 */
function _push(v: number): void {
  _wrS(cpuRegister.SP, v);
  cpuRegister.SP = (cpuRegister.SP - 1) & 0xffff;
}

/**
 * スタックから 1 ワード取り出す（SSBR セグメント）。
 * @returns 取り出した 16bit 値
 */
function _pop(): number {
  cpuRegister.SP = (cpuRegister.SP + 1) & 0xffff;
  return _rdS(cpuRegister.SP);
}

// ─────────────────────────────────────────────
// 割り込み処理
// ─────────────────────────────────────────────
/**
 * 指定レベルへ割り込みを受理する（OPSW 退避 → NPSW ロード）。
 * @param lv 割り込みレベル 0〜2
 */
function _acceptIrq(lv: number): void {
  _pendingIRQ &= ~(1 << lv);
  cpuRegister.OSR[lv] = cpuRegister.CSBR & 0xf;
  cpuRegister.CSBR = 0;
  _wrPhys(_phys(lv * 2, 0), cpuRegister.STR);
  _wrPhys(_phys(lv * 2 + 1, 0), cpuRegister.IC);
  const npsw = (cpuRegister.NPP & 0xff) << 8;
  cpuRegister.STR = _rdPhys(_phys(npsw + lv * 2, 0));
  cpuRegister.IC = _rdPhys(_phys(npsw + lv * 2 + 1, 0));
}

/**
 * ペンディング中の割り込みを 1 件処理する。
 * レベル 0 から順に見て、STR の Mx マスクが有効なものだけ受け付ける。
 * OPSW（STR/IC）を物理 0 番地側へ退避し、NPP が指す NPSW をロードする。
 */
function _handleIRQ(): void {
  for (let lv = 0; lv <= 2; lv++) {
    const mask = [STR_M0, STR_M1, STR_M2][lv];
    if (_pendingIRQ & (1 << lv) && cpuRegister.STR & mask) {
      _acceptIrq(lv);
      break;
    }
  }
}

/**
 * 未定義命令トラップ: IISR bit15 を立て、レベル0内部割り込みを即時受理する。
 * M0 マスクは問わない（MN1613.mdc: 未定義命令 → レベル0内部割り込みが発生）。
 * HALT にはしない（MN1610 の「未定義＝H」とは異なる）。
 */
function _trapUndefinedInsn(): void {
  // 未定義命令は IISR の未定義通知（bit15）を立てる。
  cpuRegister.IISR |= 0x8000;
  cpuRegister.IISR |= 0x0001;
  _acceptIrq(0);
}

// ─────────────────────────────────────────────
// IBM 16進浮動小数点（MN1613）
// R0= S EEEEEEE MMMMMMMM  R1= MMMMMMMM MMMMMMMM
// 指数: 40H = 16^0（下駄履き）。値 = ±mant × 16^(exp-70)
// 正規化: 仮数上位 4bit ≠ 0。0.0 は全 32bit 0。
// オーバーフロー → V=1（結果不定）／アンダーフロー → 0
// ─────────────────────────────────────────────

/** 2語 → JS number */
function _fpFromWords(w0: number, w1: number): number {
  if ((w0 | w1) === 0) return 0;
  const sign = w0 >>> 15;
  const exp = (w0 >>> 8) & 0x7f;
  const mant = ((w0 & 0xff) << 16) | (w1 & 0xffff);
  const val = mant * Math.pow(16, exp - 70);
  return sign ? -val : val;
}

/**
 * JS number → IBM hex float 2語
 * @returns overflow なら true（呼び出し側で V を立て、レジスタは書かない想定も可）
 */
function _fpToWords(v: number): {
  w0: number;
  w1: number;
  overflow: boolean;
} {
  if (v === 0) return { w0: 0, w1: 0, overflow: false };
  if (!Number.isFinite(v)) return { w0: 0, w1: 0, overflow: true };

  const sign = v < 0 ? 1 : 0;
  const abs = Math.abs(v);
  // abs ∈ [16^k, 16^(k+1)) → exp=k+65、mant ∈ [0x100000, 0x1000000)
  let exp = Math.floor(Math.log(abs) / Math.log(16)) + 65;
  if (!Number.isFinite(exp)) return { w0: 0, w1: 0, overflow: true };

  let mant = Math.round(abs * Math.pow(16, 70 - exp));
  while (mant < 0x100000 && exp > 0) {
    mant *= 16;
    exp--;
  }
  while (mant >= 0x1000000 && exp < 127) {
    mant = Math.floor(mant / 16);
    exp++;
  }

  // アンダーフロー → 0（V は立てない）
  if (exp < 0 || mant < 0x100000) {
    return { w0: 0, w1: 0, overflow: false };
  }
  // オーバーフロー
  if (exp > 127 || mant >= 0x1000000) {
    return { w0: 0, w1: 0, overflow: true };
  }

  mant &= 0xffffff;
  const w0 = (sign << 15) | ((exp & 0x7f) << 8) | ((mant >>> 16) & 0xff);
  const w1 = mant & 0xffff;
  return { w0, w1, overflow: false };
}

/**
 * DR0（R0/R1 ペア）の IBM 16進浮動小数点をデコードする。
 * @returns JS の number
 */
function _fpDecode(): number {
  return _fpFromWords(cpuRegister.R[0], cpuRegister.R[1]);
}

/** DR0 にエンコード。オーバーフロー時は V=1 で DR0 を 0 にする */
function _fpEncode(v: number): void {
  const enc = _fpToWords(v);
  cpuRegister.R[0] = enc.w0;
  cpuRegister.R[1] = enc.w1;
  _setOVF(enc.overflow);
}

/** メモリ上の 2語から IBM hex float をデコード（CSBR セグメント） */
function _fpDecodeAt(ea: number): number {
  return _fpFromWords(_rdC(ea), _rdC((ea + 1) & 0xffff));
}

/** 浮動小数点演算後の共通: E=0、スキップ判定は DR0 全体 */
function _fpFinish(kkkk: number): void {
  _setE(false);
  if (_skip(kkkk, cpuRegister.R[0] | cpuRegister.R[1])) _skipNext();
}

// ─────────────────────────────────────────────
// LAD 演算: BCD 桁上がり補正値計算
// ─────────────────────────────────────────────
/**
 * LAD 用の BCD 桁上がり補正値を求める。
 * ニブルごとに a+b が 9 を超えたら 6 を立てる。
 * @param a 被加算値（16bit）
 * @param b 加算値（16bit）
 * @returns 補正値（16bit）
 */
function _ladResult(a: number, b: number): number {
  let res = 0;
  for (let shift = 0; shift < 16; shift += 4) {
    const na = (a >>> shift) & 0xf;
    const nb = (b >>> shift) & 0xf;
    res |= (na + nb > 9 ? 6 : 0) << shift;
  }
  return res & 0xffff;
}

/** DSWP: ビット 4〜7 と 8〜11 を入れ替え */
function _dswp(v: number): number {
  const lo4 = v & 0x000f;
  const nib1 = (v >>> 4) & 0x000f;
  const nib2 = (v >>> 8) & 0x000f;
  const hi4 = (v >>> 12) & 0x000f;
  return (hi4 << 12) | (nib1 << 8) | (nib2 << 4) | lo4;
}

// ─────────────────────────────────────────────
// セグメント / 特殊 / HW レジスタアクセス
// ─────────────────────────────────────────────

/**
 * セグメントレジスタを読む。
 * @param bbb 0=CSBR 1=SSBR 2=TSR0 3=TSR1 4〜7=OSR0〜OSR3
 * @returns セグメント値（4bit）
 */
function _getSegReg(bbb: number): number {
  switch (bbb & 7) {
    case 0:
      return cpuRegister.CSBR;
    case 1:
      return cpuRegister.SSBR;
    case 2:
      return cpuRegister.TSR0;
    case 3:
      return cpuRegister.TSR1;
    case 4:
      return cpuRegister.OSR[0];
    case 5:
      return cpuRegister.OSR[1];
    case 6:
      return cpuRegister.OSR[2];
    default:
      return cpuRegister.OSR[3];
  }
}

/**
 * セグメントレジスタへ書く。CSBR（bbb=0）への直接書き込みは無視する。
 * @param bbb 1=SSBR 2=TSR0 3=TSR1 4〜7=OSR0〜OSR3
 * @param v セグメント値（下位 4bit のみ有効）
 */
function _setSegReg(bbb: number, v: number): void {
  switch (bbb & 7) {
    case 1:
      cpuRegister.SSBR = v & 0xf;
      break;
    case 2:
      cpuRegister.TSR0 = v & 0xf;
      break;
    case 3:
      cpuRegister.TSR1 = v & 0xf;
      break;
    case 4:
      cpuRegister.OSR[0] = v & 0xf;
      break;
    case 5:
      cpuRegister.OSR[1] = v & 0xf;
      break;
    case 6:
      cpuRegister.OSR[2] = v & 0xf;
      break;
    case 7:
      cpuRegister.OSR[3] = v & 0xf;
      break;
    // bbb=0(CSBR) への直接書き込みは禁止
  }
}

/**
 * 特殊レジスタを読む。
 * @param ppp 0=SBRB 1=ICB 2=NPP
 * @returns レジスタ値。未定義の ppp は 0
 */
function _getSpecReg(ppp: number): number {
  switch (ppp & 7) {
    case 0:
      return cpuRegister.SBRB;
    case 1:
      return cpuRegister.ICB;
    case 2:
      return cpuRegister.NPP;
    default:
      return 0;
  }
}

/**
 * 特殊レジスタへ書く。未定義の ppp は無視する。
 * @param ppp 0=SBRB(8bit) 1=ICB(16bit) 2=NPP(8bit)
 * @param v 書き込む値
 */
function _setSpecReg(ppp: number, v: number): void {
  switch (ppp & 7) {
    case 0:
      cpuRegister.SBRB = v & 0xff;
      break;
    case 1:
      cpuRegister.ICB = v & 0xffff;
      break;
    case 2:
      cpuRegister.NPP = v & 0xff;
      break;
  }
}

/**
 * ハードウェアレジスタを読む。実装しているのは IISR のみ。
 * @param hhh 6=IISR。それ以外は 0 を返す
 * @returns レジスタ値
 */
function _getHWReg(hhh: number): number {
  return hhh === 6 ? cpuRegister.IISR : 0;
}

/**
 * ハードウェアレジスタへ書く。実装しているのは IISR のみ。
 * @param hhh 6=IISR。それ以外は無視
 * @param v 16bit 値
 */
function _setHWReg(hhh: number, v: number): void {
  if (hhh === 6) {
    // IISR の bit15（未定義通知）は sticky として保持し、
    // seth 側では bit0 だけを更新する（未定義フラグクリアは bit0 を 0 にする想定）。
    const msb = cpuRegister.IISR & 0x8000;
    cpuRegister.IISR = msb | (v & 0x0001);
  }
}

// ─────────────────────────────────────────────
// 命令実行本体
// ─────────────────────────────────────────────
/**
 * 1 命令をフェッチ・デコード・実行する。
 * 先頭でペンディング割り込みを処理し、未定義命令ならレベル0内部割り込みへ遷移する。
 */
function _executeOne(): void {
  if (_pendingIRQ) _handleIRQ();
  _onBeforeExecute?.(getState());

  const ir = _fetch();
  stepBreak.onInstructionFetch(ir);
  const op = (ir >>> 11) & 0x1f;
  const rrr = (ir >>> 8) & 0x7;
  const lo = ir & 0xff;

  // ━━━ グループ 0x18〜0x1F: L / B / IMS（11MMM RRR dddddddd）
  // ━━━ グループ 0x10〜0x17: ST / BAL / DMS（10MMM RRR dddddddd）
  if (op >= 0x10) {
    const mmm = op & 7;
    const ea = _ea(mmm, lo);
    const isHi = (op & 8) !== 0; // bit3: 1=L/B/IMS  0=ST/BAL/DMS
    if (rrr === 7) {
      if (isHi) {
        cpuRegister.IC = ea;
      } // B: 無条件分岐
      else {
        _push(cpuRegister.IC);
        cpuRegister.IC = ea;
      } // BAL: SSBR スタックに IC 積んで分岐
    } else if (rrr === 6) {
      const cur = _rdC(ea);
      const res = isHi ? (cur + 1) & 0xffff : (cur - 1) & 0xffff;
      _wrC(ea, res);
      if (res === 0) _skipNext(); // IMS / DMS
    } else {
      if (isHi) {
        _sw(rrr, _rdC(ea));
      } // L
      else {
        _wrC(ea, _gr(rrr));
      } // ST
    }
  } else {
  switch (op) {
    // ── 0x00: 未定義 → レベル0内部割り込み ─────────────────────────────
    case 0x00:
      _trapUndefinedInsn();
      break;

    // ── 0x01: MVI / LB / LS / STB / STS / CPYB / CPYS / SETB / SETS ─
    case 0x01: {
      if (rrr !== 7) {
        // MVI R, imm8: 下位 8bit をロード（上位は不変）
        _sw(rrr, (_gr(rrr) & 0xff00) | lo);
      } else {
        const bit7 = (lo >>> 7) & 1; // 1=STB/STS/CPYB/CPYS  0=LB/LS/SETB/SETS
        const bBits = (lo >>> 4) & 7; // bits[6:4] = bbb or ppp
        const bit3 = (lo >>> 3) & 1; // 1=LS/STS/CPYS/SETS  0=LB/STB/CPYB/SETB
        const bLo = lo & 7; // bits[2:0] = ddd/sss or 7=2語命令
        if (bLo === 7) {
          const ad16 = _fetch();
          if (bit7 === 0 && bit3 === 0) {
            if (bBits !== 0) _setSegReg(bBits, _rdC(ad16) & 0xf);
          } // LB
          else if (bit7 === 0 && bit3 === 1) {
            _setSpecReg(bBits, _rdC(ad16));
          } // LS
          else if (bit7 === 1 && bit3 === 0) {
            _wrC(ad16, _getSegReg(bBits));
          } // STB
          else {
            _wrC(ad16, _getSpecReg(bBits));
          } // STS
        } else {
          if (bit7 === 1 && bit3 === 0) {
            _sw(bLo, _getSegReg(bBits));
          } // CPYB
          else if (bit7 === 1 && bit3 === 1) {
            _sw(bLo, _getSpecReg(bBits));
          } // CPYS
          else if (bit7 === 0 && bit3 === 0) {
            if (bBits !== 0) _setSegReg(bBits, _gr(bLo) & 0xf);
          } // SETB
          else {
            _setSpecReg(bBits, _gr(bLo));
          } // SETS
        }
      }
      break;
    }

    // ── 0x02: WT / PSHM / POPM / TSET / TRST ─────────────────────────
    case 0x02: {
      if (rrr !== 7) {
        _doIoWrite(lo, _gr(rrr)); // WT Rs, imm8_io
      } else if (lo === 0x0f) {
        for (let i = 0; i <= 4; i++) _push(cpuRegister.R[i]); // PSHM
      } else if (lo === 0x07) {
        for (let i = 4; i >= 0; i--) cpuRegister.R[i] = _pop(); // POPM
      } else {
        const ad16 = _fetch();
        const kkkk = (lo >>> 4) & 0xf;
        const sss = lo & 7;
        const mem = _rdC(ad16);
        const rs = _gr(sss);
        const test = mem & rs;
        const res = lo & 8 ? mem | rs : mem & ~rs; // TSET : TRST
        _wrC(ad16, res & 0xffff);
        if (_skip(kkkk, test)) _skipNext();
      }
      break;
    }

    // ── 0x03: RD / NEG / FIX / FLT ───────────────────────────────────
    case 0x03: {
      if (rrr !== 7) {
        _sw(rrr, _doIoRead(lo) & 0xffff); // RD R, imm8_io
      } else {
        const kkkk = (lo >>> 4) & 0xf;
        const bit3 = (lo >>> 3) & 1;
        const bit2 = (lo >>> 2) & 1;
        if (bit2 === 1) {
          if (bit3 === 0) {
            // FIX R0, DR0: 浮動小数点 → int16
            const v = Math.trunc(_fpDecode());
            const ov = v > 32767 || v < -32768;
            _setE(false);
            _setOVF(ov);
            cpuRegister.R[0] = ov ? 0 : v & 0xffff;
            if (_skip(kkkk, cpuRegister.R[0])) _skipNext();
          } else {
            // FLT DR0, R0: int16 → 浮動小数点
            const s16 =
              cpuRegister.R[0] < 0x8000
                ? cpuRegister.R[0]
                : cpuRegister.R[0] - 0x10000;
            _fpEncode(s16);
            _setE(false);
            if (_skip(kkkk, cpuRegister.R[0] | cpuRegister.R[1])) _skipNext();
          }
        } else {
          // NEG Rd: Rd ← -(Rd) [- E if c=0]
          const ddd = lo & 7;
          const carry = bit3 === 0 ? (cpuRegister.STR & STR_E ? 1 : 0) : 0;
          const r1 = _sub(0, _gr(ddd));
          const r2 = _sub(r1, carry);
          _sw(ddd, r2);
          if (_skip(kkkk, r2)) _skipNext();
        }
      }
      break;
    }

    // ── 0x04: 大型グループ ────────────────────────────────────────────
    case 0x04:
      _exec04(rrr, lo);
      break;

    // ── 0x05: TBIT ────────────────────────────────────────────────────
    case 0x05: {
      const kkkk = (lo >>> 4) & 0xf;
      const bitN = lo & 0xf; // ビット番号（MSB=0）
      const mask = 1 << (15 - bitN);
      if (_skip(kkkk, _gr(rrr) & mask)) _skipNext();
      break;
    }

    // ── 0x06: RBIT ────────────────────────────────────────────────────
    case 0x06: {
      const kkkk = (lo >>> 4) & 0xf;
      const mask = 1 << (15 - (lo & 0xf));
      const res = _gr(rrr) & ~mask & 0xffff;
      _sw(rrr, res);
      if (_skip(kkkk, res)) _skipNext();
      break;
    }

    // ── 0x07: SBIT / SRBT / DEBP / BLK / RETL / SETH / CPYH ─────────
    case 0x07: {
      if (rrr !== 7) {
        // SBIT R, #N, skip
        const kkkk = (lo >>> 4) & 0xf;
        const mask = 1 << (15 - (lo & 0xf));
        const res = (_gr(rrr) | mask) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext();
      } else if (lo === 0x07) {
        // RETL: CSBR と IC を SSBR スタックから復元
        cpuRegister.CSBR = _pop() & 0xf;
        cpuRegister.IC = _pop();
      } else if (lo === 0x17) {
        // BLK: R0 語分を TSR0:R1(ソース) → TSR1:R2(デスティネーション) へ転送
        // 仕様: 「R1とTSR0で指定されるアドレスから R2とTSR1で指定されるアドレスへ」
        while (cpuRegister.R[0] !== 0) {
          _wrB(
            cpuRegister.R[2],
            _rdB(cpuRegister.R[1], cpuRegister.TSR0),
            cpuRegister.TSR1,
          );
          cpuRegister.R[1] = (cpuRegister.R[1] + 1) & 0xffff;
          cpuRegister.R[2] = (cpuRegister.R[2] + 1) & 0xffff;
          cpuRegister.R[0] = (cpuRegister.R[0] - 1) & 0xffff;
        }
      } else if (lo >>> 4 === 0x7 && (lo & 8) === 0) {
        // SRBT R0, Rs: MSB から最初の 1ビットを検索
        const sss = lo & 7;
        let v = _gr(sss);
        let pos = 0x10;
        for (let b = 15; b >= 0; b--) {
          if ((v >>> b) & 1) {
            pos = 15 - b;
            v &= ~(1 << b);
            break;
          }
        }
        cpuRegister.R[0] = pos;
        _sw(sss, v & 0xffff);
      } else if (lo >>> 4 === 0xf && (lo & 8) === 0) {
        // DEBP Rd, R0: R0 下位 4bit のビット番号でビットセット
        const ddd2 = lo & 7;
        _sw(
          ddd2,
          (_gr(ddd2) | (1 << (15 - (cpuRegister.R[0] & 0xf)))) & 0xffff,
        );
      } else {
        // SETH / CPYH
        const bit7 = (lo >>> 7) & 1;
        const hhh = (lo >>> 4) & 7;
        const rdSrc = lo & 7;
        if (bit7 === 1)
          _sw(rdSrc, _getHWReg(hhh)); // CPYH
        else _setHWReg(hhh, _gr(rdSrc)); // SETH
      }
      break;
    }

    // ── 0x08: SI / SD ─────────────────────────────────────────────────
    case 0x08: {
      const kkkk = (lo >>> 4) & 0xf;
      if (rrr === 7 && lo & 4) {
        // SD DR0, (Ri) [, C]
        const c = (lo >>> 3) & 1;
        const ii = lo & 3;
        const ea = _ri(ii);
        const mh = _rdC(ea);
        const ml = _rdC((ea + 1) & 0xffff);
        const e0 = c === 0 ? (cpuRegister.STR & STR_E ? 1 : 0) : 0;
        const d =
          cpuRegister.R[0] * 65536 + cpuRegister.R[1] - (mh * 65536 + ml) - e0;
        _setE(d < 0);
        _setOVF(false);
        const du = d < 0 ? d + 0x100000000 : d;
        cpuRegister.R[0] = (du >>> 16) & 0xffff;
        cpuRegister.R[1] = du & 0xffff;
        if (_skip(kkkk, cpuRegister.R[0] | cpuRegister.R[1])) _skipNext();
      } else {
        // SI R, #imm4（フラグ変化なし、スキップ条件は結果で評価: MN1610 仕様）
        const dddd = lo & 0xf;
        const siRes = (_gr(rrr) - dddd) & 0xffff;
        _sw(rrr, siRes);
        if (_skip(kkkk, siRes)) _skipNext();
      }
      break;
    }

    // ── 0x09: AI / AD ─────────────────────────────────────────────────
    case 0x09: {
      const kkkk = (lo >>> 4) & 0xf;
      if (rrr === 7 && lo & 4) {
        // AD DR0, (Ri) [, C]
        const c = (lo >>> 3) & 1;
        const ii = lo & 3;
        const ea = _ri(ii);
        const mh = _rdC(ea);
        const ml = _rdC((ea + 1) & 0xffff);
        const e0 = c === 0 ? (cpuRegister.STR & STR_E ? 1 : 0) : 0;
        const d =
          cpuRegister.R[0] * 65536 + cpuRegister.R[1] + (mh * 65536 + ml) + e0;
        _setE(d > 0xffffffff);
        _setOVF(false);
        const du = d >>> 0;
        cpuRegister.R[0] = (du >>> 16) & 0xffff;
        cpuRegister.R[1] = du & 0xffff;
        if (_skip(kkkk, cpuRegister.R[0] | cpuRegister.R[1])) _skipNext();
      } else {
        // AI R, #imm4（フラグ変化なし、スキップ条件は結果で評価）
        const aiRes = (_gr(rrr) + (lo & 0xf)) & 0xffff;
        _sw(rrr, aiRes);
        if (_skip(kkkk, aiRes)) _skipNext();
      }
      break;
    }

    // ── 0x0A: C / CB / CWR / CWI / CBR / CBI / DAS ───────────────────
    case 0x0a: {
      const kkkk = (lo >>> 4) & 0xf;
      const b32 = (lo >>> 2) & 3;
      const b10 = lo & 3;
      const b3 = (lo >>> 3) & 1;
      if (rrr === 7) {
        if (lo & 4) {
          // DAS R0, (Ri) [, C]
          const c = b3;
          const ii = b10;
          const m = _rdC(_ri(ii));
          const e0 = c === 0 ? (cpuRegister.STR & STR_E ? 1 : 0) : 0;
          let res = cpuRegister.R[0] - m - e0;
          _setE(res < 0);
          if ((cpuRegister.R[0] & 0xf) - (m & 0xf) - e0 < 0) res -= 0x06;
          if (((cpuRegister.R[0] >>> 4) & 0xf) - ((m >>> 4) & 0xf) < 0)
            res -= 0x60;
          cpuRegister.R[0] = res & 0xffff;
          if (_skip(kkkk, cpuRegister.R[0])) _skipNext();
        } else if (b32 === 2) {
          const res = _sub(cpuRegister.R[0], _rdC(_ri(b10)));
          if (_skip(kkkk, res)) _skipNext(); // CWR
        } else {
          const res = _sub(cpuRegister.R[0] & 0xff, _rdC(_ri(b10)) & 0xff);
          if (_skip(kkkk, res)) _skipNext(); // CBR
        }
      } else if (b3 === 1 && (lo & 7) === 7) {
        const imm = _fetch();
        if (_skip(kkkk, _sub(_gr(rrr), imm))) _skipNext(); // CWI
      } else if (b3 === 0 && (lo & 7) === 7) {
        const imm = _fetch();
        if (_skip(kkkk, _sub(_gr(rrr) & 0xff, imm & 0xff))) _skipNext(); // CBI
      } else if (b3 === 1) {
        if (_skip(kkkk, _sub(_gr(rrr), _gr(lo & 7)))) _skipNext(); // C
      } else {
        if (_skip(kkkk, _sub(_gr(rrr) & 0xff, _gr(lo & 7) & 0xff))) _skipNext(); // CB
      }
      break;
    }

    // ── 0x0B: A / S / AWR / SWR / AWI / SWI / DAA ────────────────────
    case 0x0b: {
      const kkkk = (lo >>> 4) & 0xf;
      const b32 = (lo >>> 2) & 3;
      const b10 = lo & 3;
      const b3 = (lo >>> 3) & 1;
      if (rrr === 7) {
        if (lo & 4) {
          // DAA R0, (Ri) [, C]
          const c = b3;
          const ii = b10;
          const m = _rdC(_ri(ii));
          const e0 = c === 0 ? (cpuRegister.STR & STR_E ? 1 : 0) : 0;
          let res = cpuRegister.R[0] + m + e0;
          _setE(res > 0xffff);
          if ((cpuRegister.R[0] & 0xf) + (m & 0xf) + e0 > 9) res += 0x06;
          if (((res >>> 8) & 0xff) > 0x99) res += 0x0600;
          cpuRegister.R[0] = res & 0xffff;
          if (_skip(kkkk, cpuRegister.R[0])) _skipNext();
        } else if (b32 === 2) {
          const res = _add(cpuRegister.R[0], _rdC(_ri(b10)));
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // AWR
        } else if (b32 === 0) {
          const res = _sub(cpuRegister.R[0], _rdC(_ri(b10)));
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // SWR
        } else if (b3 === 1 && (lo & 7) === 7) {
          const res = _add(cpuRegister.IC, _fetch());
          cpuRegister.IC = res;
          if (_skip(kkkk, res)) _skipNext(); // AWI IC
        } else {
          const res = _sub(cpuRegister.IC, _fetch());
          cpuRegister.IC = res;
          if (_skip(kkkk, res)) _skipNext(); // SWI IC
        }
      } else if (b3 === 1 && (lo & 7) === 7) {
        const imm = _fetch();
        const res = _add(_gr(rrr), imm);
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // AWI
      } else if (b3 === 0 && (lo & 7) === 7) {
        const imm = _fetch();
        const res = _sub(_gr(rrr), imm);
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // SWI
      } else if (b3 === 1) {
        const res = _add(_gr(rrr), _gr(lo & 7));
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // A
      } else {
        const res = _sub(_gr(rrr), _gr(lo & 7));
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // S
      }
      break;
    }

    // ── 0x0C: OR / EOR / ORR / ORI / EORR / EORI / FM / FD ──────────
    case 0x0c: {
      const kkkk = (lo >>> 4) & 0xf;
      const b32 = (lo >>> 2) & 3;
      const b10 = lo & 3;
      const b3 = (lo >>> 3) & 1;
      if (rrr === 7) {
        if (b32 === 3) {
          // FM DR0, (Ri)
          _fpEncode(_fpDecode() * _fpDecodeAt(_ri(b10)));
          _fpFinish(kkkk);
        } else if (b32 === 1) {
          // FD DR0, (Ri)
          const me = _fpDecodeAt(_ri(b10));
          if (me === 0) {
            _setOVF(true);
            _setE(false);
            if (_skip(kkkk, cpuRegister.R[0] | cpuRegister.R[1])) _skipNext();
          } else {
            _fpEncode(_fpDecode() / me);
            _fpFinish(kkkk);
          }
        } else if (b32 === 2) {
          const res = (cpuRegister.R[0] | _rdC(_ri(b10))) & 0xffff;
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // ORR
        } else {
          const res = (cpuRegister.R[0] ^ _rdC(_ri(b10))) & 0xffff;
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // EORR
        }
      } else if (b3 === 1 && (lo & 7) === 7) {
        const imm = _fetch();
        const res = (_gr(rrr) | imm) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // ORI
      } else if (b3 === 0 && (lo & 7) === 7) {
        const imm = _fetch();
        const res = (_gr(rrr) ^ imm) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // EORI
      } else if (b3 === 1) {
        const res = (_gr(rrr) | _gr(lo & 7)) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // OR
      } else {
        const res = (_gr(rrr) ^ _gr(lo & 7)) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // EOR
      }
      break;
    }

    // ── 0x0D: AND / LAD / ANDR / ANDI / LADR / LADI / FA / FS ────────
    case 0x0d: {
      const kkkk = (lo >>> 4) & 0xf;
      const b32 = (lo >>> 2) & 3;
      const b10 = lo & 3;
      const b3 = (lo >>> 3) & 1;
      if (rrr === 7) {
        if (b32 === 3) {
          // FA DR0, (Ri)
          _fpEncode(_fpDecode() + _fpDecodeAt(_ri(b10)));
          _fpFinish(kkkk);
        } else if (b32 === 1) {
          // FS DR0, (Ri)
          _fpEncode(_fpDecode() - _fpDecodeAt(_ri(b10)));
          _fpFinish(kkkk);
        } else if (b32 === 2) {
          const res = cpuRegister.R[0] & _rdC(_ri(b10)) & 0xffff;
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // ANDR
        } else {
          const res = _ladResult(cpuRegister.R[0], _rdC(_ri(b10)));
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // LADR
        }
      } else if (b3 === 1 && (lo & 7) === 7) {
        const imm = _fetch();
        const res = _gr(rrr) & imm & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // ANDI
      } else if (b3 === 0 && (lo & 7) === 7) {
        const imm = _fetch();
        const res = _ladResult(_gr(rrr), imm);
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // LADI
      } else if (b3 === 1) {
        const res = _gr(rrr) & _gr(lo & 7) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // AND
      } else {
        const res = _ladResult(_gr(rrr), _gr(lo & 7));
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // LAD
      }
      break;
    }

    // ── 0x0E: BSWP / DSWP / BSWR / DSWR / D ──────────────────────────
    case 0x0e: {
      const kkkk = (lo >>> 4) & 0xf;
      const b32 = (lo >>> 2) & 3;
      const b10 = lo & 3;
      const b3 = (lo >>> 3) & 1;
      if (rrr === 7) {
        if (b32 === 3) {
          // D DR0, (Ri): 符号なし 32bit ÷ 16bit → 商 R0 / 剰余 R1
          const div = _rdC(_ri(b10));
          _setE(false);
          if (div === 0) {
            _setOVF(true);
            break;
          }
          const n32 = ((cpuRegister.R[0] << 16) | cpuRegister.R[1]) >>> 0;
          const q = Math.floor(n32 / div);
          const r = n32 % div;
          if (q > 0xffff) {
            _setOVF(true);
            break;
          }
          _setOVF(false);
          cpuRegister.R[0] = q & 0xffff;
          cpuRegister.R[1] = r & 0xffff;
          if (_skip(kkkk, cpuRegister.R[0])) _skipNext();
        } else if (b32 === 2) {
          const v = _rdC(_ri(b10));
          const res = ((v & 0xff) << 8) | (v >>> 8); // BSWR
          cpuRegister.R[0] = res & 0xffff;
          if (_skip(kkkk, res)) _skipNext();
        } else {
          const res = _dswp(_rdC(_ri(b10)));
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // DSWR
        }
      } else if (b3 === 1) {
        const v = _gr(lo & 7);
        const res = (((v & 0xff) << 8) | (v >>> 8)) & 0xffff;
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // BSWP
      } else {
        const res = _dswp(_gr(lo & 7));
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // DSWP
      }
      break;
    }

    // ── 0x0F: MV / MVB / MVWR / MVWI / MVBR / M ──────────────────────
    case 0x0f: {
      const kkkk = (lo >>> 4) & 0xf;
      const b32 = (lo >>> 2) & 3;
      const b10 = lo & 3;
      const b3 = (lo >>> 3) & 1;
      if (rrr === 7) {
        if (b32 === 3) {
          // M DR0, (Ri): 符号なし 16bit × 16bit → 32bit
          const p = cpuRegister.R[0] * _rdC(_ri(b10));
          _setOVF(false);
          _setE(false);
          cpuRegister.R[0] = (p >>> 16) & 0xffff;
          cpuRegister.R[1] = p & 0xffff;
          if (_skip(kkkk, cpuRegister.R[0] | cpuRegister.R[1])) _skipNext();
        } else if (b32 === 2) {
          const res = _rdC(_ri(b10));
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext(); // MVWR
        } else if (b3 === 0 && (lo & 7) === 7) {
          cpuRegister.IC = _fetch(); // MVWI IC, imm16（JMP 相当）
        } else {
          const res = (cpuRegister.R[0] & 0xff00) | (_rdC(_ri(b10)) & 0xff); // MVBR
          cpuRegister.R[0] = res;
          if (_skip(kkkk, res)) _skipNext();
        }
      } else if ((lo & 7) === 7 && b3 === 0) {
        const imm = _fetch();
        _sw(rrr, imm);
        if (_skip(kkkk, imm)) _skipNext(); // MVWI
      } else if (b3 === 1) {
        const res = _gr(lo & 7);
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext(); // MV
      } else {
        const res = (_gr(rrr) & 0xff00) | (_gr(lo & 7) & 0xff); // MVB
        _sw(rrr, res);
        if (_skip(kkkk, res)) _skipNext();
      }
      break;
    }

    default:
      _trapUndefinedInsn();
      break;
  }
  }
  _onAfterExecute?.(getState());
}

// ─────────────────────────────────────────────
// グループ 0x04 サブデコーダ
// ─────────────────────────────────────────────
/**
 * オペコードグループ 0x04 のサブデコーダ（MN1613 拡張命令が集まる領域）。
 * @param rrr 命令語のレジスタフィールド（bit10〜8）
 * @param lo 命令語の下位 8bit
 */
function _exec04(rrr: number, lo: number): void {
  const b32 = (lo >>> 2) & 3;
  const b76 = (lo >>> 6) & 3; // mm
  const b54 = (lo >>> 4) & 3; // BB
  const b10 = lo & 3;
  const kkkk = (lo >>> 4) & 0xf;
  const ee = b10;

  // H / RET / LPSW（RRR=0 専用）
  if (rrr === 0) {
    if (lo === 0x00) {
      _execStatus = "halted";
      return;
    }
    if (lo === 0x03) {
      cpuRegister.IC = _pop();
      return;
    } // RET
    if (lo >= 0x04 && lo <= 0x07) {
      const ll = lo & 3;
      cpuRegister.STR = _rdPhys(_phys(ll * 2, 0));
      cpuRegister.IC = _rdPhys(_phys(ll * 2 + 1, 0));
      cpuRegister.CSBR = cpuRegister.OSR[ll] & 0xf;
      return; // LPSW
    }
  }

  // BD / BALD（RRR=6 専用）
  if (rrr === 6) {
    if (lo === 0x07) {
      cpuRegister.IC = _fetch();
      return;
    } // BD addr16
    if (lo === 0x17) {
      // 2語命令: 先にリンク先をフェッチしてから戻り先（次命令）を push
      const dest = _fetch();
      _push(cpuRegister.IC);
      cpuRegister.IC = dest;
      return;
    } // BALD addr16
  }

  // RRR=7 専用: BR / BALR / LD / STD / BL / BALL
  if (rrr === 7) {
    if ((lo & 0xfc) === 0x04) {
      _execSegBranch(b10, false);
      return;
    } // BR (Ri)
    if ((lo & 0xfc) === 0x14) {
      _execSegBranch(b10, true);
      return;
    } // BALR (Ri)
    if (lo & 0x08) {
      const bb = b54;
      const dest = lo & 7;
      const ad16 = _fetch();
      if ((lo & 0x40) === 0) {
        // LD / BL / BALL（bit6=0）
        if (dest === 7) {
          if (bb === 1) {
            _push(cpuRegister.IC);
            _push(cpuRegister.CSBR);
          } // BALL: push IC then CSBR
          const nc = _rdB(ad16, cpuRegister.CSBR) & 0xf;
          const ni = _rdB((ad16 + 1) & 0xffff, cpuRegister.CSBR);
          cpuRegister.CSBR = nc;
          cpuRegister.IC = ni; // BL / BALL: load new CSBR and IC
        } else {
          _sw(dest, _rdB(ad16, _seg(bb))); // LD Rd, [BB:addr]
        }
      } else {
        _wrB(ad16, _gr(dest), _seg(bb)); // STD Rs, [BB:addr]
      }
      return;
    }
  }

  // 共通: PUSH / POP
  if (lo === 0x01) {
    _push(_gr(rrr));
    return;
  }
  if (lo === 0x02) {
    _sw(rrr, _pop());
    return;
  }

  // LR: bits[3:2]=00、mm≠00
  if (b32 === 0 && b76 !== 0) {
    const seg = _seg(b54);
    let ea: number;
    if (b76 === 1) {
      ea = _ri(b10);
    } else if (b76 === 2) {
      _riSet(b10, (_ri(b10) - 1) & 0xffff);
      ea = _ri(b10);
    } else {
      ea = _ri(b10);
      _riSet(b10, (_ri(b10) + 1) & 0xffff);
    }
    _sw(rrr, _rdB(ea, seg));
    return;
  }

  // STR 命令: bits[3:2]=01、mm≠00
  if (b32 === 1 && b76 !== 0) {
    const seg = _seg(b54);
    let ea: number;
    if (b76 === 1) {
      ea = _ri(b10);
    } else if (b76 === 2) {
      _riSet(b10, (_ri(b10) - 1) & 0xffff);
      ea = _ri(b10);
    } else {
      ea = _ri(b10);
      _riSet(b10, (_ri(b10) + 1) & 0xffff);
    }
    _wrB(ea, _gr(rrr), seg);
    return;
  }

  // SR: bits[3:2]=10
  if (b32 === 2) {
    _applyEE(ee);
    const a = _gr(rrr);
    const eIn = cpuRegister.STR & STR_E ? 0x8000 : 0;
    _setE((a & 1) !== 0);
    const res = ((a >>> 1) | eIn) & 0xffff;
    _sw(rrr, res);
    if (_skip(kkkk, res)) _skipNext();
    return;
  }

  // SL: bits[3:2]=11
  if (b32 === 3) {
    _applyEE(ee);
    const a = _gr(rrr);
    const eIn = cpuRegister.STR & STR_E ? 1 : 0;
    _setE((a & 0x8000) !== 0);
    const res = ((a << 1) | eIn) & 0xffff;
    _sw(rrr, res);
    if (_skip(kkkk, res)) _skipNext();
    return;
  }

  // RDR: bits[7:4]=0001、bits[3:2]=01（RRR≠7）
  if (lo >>> 4 === 1 && b32 === 1 && rrr !== 7) {
    _sw(rrr, _doIoRead(_ri(b10)) & 0xffff);
    return;
  }

  // WTR: bits[7:4]=0001、bits[3:2]=00
  if (lo >>> 4 === 1 && b32 === 0) {
    _doIoWrite(_ri(b10), _gr(rrr));
    return;
  }

  _trapUndefinedInsn();
}

/** BR/BALR 共通: Ri の指すメモリから新しい CSBR と IC をロード */
function _execSegBranch(ii: number, link: boolean): void {
  const base = _ri(ii);
  if (link) {
    _push(cpuRegister.IC);
    _push(cpuRegister.CSBR);
  }
  const nc = _rdB(base, cpuRegister.CSBR) & 0xf;
  const ni = _rdB((base + 1) & 0xffff, cpuRegister.CSBR);
  cpuRegister.CSBR = nc;
  cpuRegister.IC = ni;
}
