/**
 * 1階 IO ボードのポートマップ（簡易）
 * 根拠: MN1613_CPUボードメモリ_IOマップ.mdc /
 *       TMS9995_CPUボードメモリ_IOマップ.mdc
 *
 * MN1613: IO 0000 / 0020〜0024 / 0030〜0034 / 0036〜0037
 * TMS9995: CRU 0010〜0012・0020〜0027、メモリ FE80〜FE87（比較器・ステップ）
 */

import type { CpuIoSignals } from "./mn1613/mn1613ioport";
import {
  setIoReadCallback,
  setIoWriteCallback,
  triggerInterrupt,
} from "./mn1613/mn1613";
import {
  createHandshakeIoPortBridge,
  IO_PORT as HSHK_IO_PORT,
} from "./handshake/io_port_bridge";
import { Tms9995CruHandshake, tms9995IoMmap } from "./tms9995";
import {
  notifyCruFlagWrite,
  readCruTimerFlagBit,
} from "./tms9995/cru_timer";
import {
  addrComparators,
  IO_PORT_BREAK_ADDR_HI,
  IO_PORT_BREAK_ADDR_LO,
  IO_PORT_BREAK_CTRL,
  IO_PORT_BREAK_HIT,
  IO_PORT_BREAK_PREV,
} from "./mn1613/addr_comparator";
import {
  IO_PORT_STEP_DELAY,
  IO_PORT_STEP_ENA,
  stepBreak,
} from "./mn1613/step_break";
import {
  INT_CAUSE_CODE,
  INT2_CAUSE_CODE,
} from "../shared/handshake/handshake_type";

/** IO:0000 — リセットベクタ（ワードアドレス） */
export const IO_PORT_RESET_VECTOR = 0x0000;

/** モニターのリセットベクタ表先頭（IO:0 が返す値。`g_reset_vector`） */
export const MONITOR_ENTRY_WORD = 0x0108;
/** IO:0 の値からの STR 語オフセット（MN1613.mdc） */
export const RESET_VECTOR_STR_OFF = 2;
/** IO:0 の値からの IC 語オフセット（MN1613.mdc） */
export const RESET_VECTOR_IC_OFF = 3;

/** H 命令オペコード */
export const OPCODE_H = 0x2000;

export const CPU_PORT_MODE = {
  MN1613: 1,
  TMS9995: 2,
} as const;

let _resetVector = MONITOR_ENTRY_WORD;
let _handshakeBus: CpuIoSignals | null = null;
let _intCause = 0;
let _interruptBusy = 0;
let _cpuPortMode: number = CPU_PORT_MODE.MN1613;
let _tmsCru = new Tms9995CruHandshake({ strictRoles: false });
let _hshkBridge: ReturnType<typeof createHandshakeIoPortBridge> | null = null;

function toBit(v: number): 0 | 1 {
  return (v & 1) === 0 ? 0 : 1;
}

function syncBusToTmsCru(): void {
  if (!_handshakeBus) return;
  _tmsCru.cpuWriteSignal("INTERRUPT_BUSY", toBit(_handshakeBus.INTERRUPT_BUSY));
  applyPackedCauseToTmsCru(_handshakeBus.INT_CAUSE);

  _tmsCru.cpuWriteSignal("HSHK_OUT_REQ", toBit(_handshakeBus.HSHK_OUT_REQ));
  _tmsCru.cpuWriteSignal("HSHK_OUT_DENA", toBit(_handshakeBus.HSHK_OUT_DENA));
  _tmsCru.cpuWriteSignal("HSHK_IN_DACK", toBit(_handshakeBus.HSHK_IN_DACK));

  _tmsCru.ioWriteSignal("HSHK_IN_REQ", toBit(_handshakeBus.HSHK_IN_REQ));
  _tmsCru.ioWriteSignal("HSHK_IN_DENA", toBit(_handshakeBus.HSHK_IN_DENA));
  _tmsCru.ioWriteSignal("HSHK_OUT_DACK", toBit(_handshakeBus.HSHK_OUT_DACK));

  _tmsCru.cpuWriteOutDataByte(_handshakeBus.HSHK_OUT_DATA & 0xff);
  _tmsCru.ioWriteInDataByte(_handshakeBus.HSHK_IN_DATA & 0xff);
}

function syncTmsCruToBus(): void {
  if (!_handshakeBus) return;
  const snap = _tmsCru.snapshot();
  _handshakeBus.INTERRUPT_BUSY = snap.cpuOutSignals.INTERRUPT_BUSY;
  // 共有バス用に MN 風へ畳む: INT1→Bit0、INT2→Bit1
  _handshakeBus.INT_CAUSE = (snap.cpuInSignals.INT1_CAUSE |
    (snap.cpuInSignals.INT2_CAUSE << 1)) as CpuIoSignals["INT_CAUSE"];

  _handshakeBus.HSHK_OUT_REQ = snap.cpuOutSignals.HSHK_OUT_REQ;
  _handshakeBus.HSHK_OUT_DENA = snap.cpuOutSignals.HSHK_OUT_DENA;
  _handshakeBus.HSHK_IN_DACK = snap.cpuOutSignals.HSHK_IN_DACK;

  _handshakeBus.HSHK_IN_REQ = snap.cpuInSignals.HSHK_IN_REQ;
  _handshakeBus.HSHK_IN_DENA = snap.cpuInSignals.HSHK_IN_DENA;
  _handshakeBus.HSHK_OUT_DACK = snap.cpuInSignals.HSHK_OUT_DACK;

  _handshakeBus.HSHK_OUT_DATA = snap.outDataByte & 0xff;
  _handshakeBus.HSHK_IN_DATA = snap.inDataByte & 0xff;
}

/**
 * MN 風 INT_CAUSE を TMS CRU（INT1=ハンドシェイク、INT2=ブレイク/ステップ）へ載せる。
 * @param cause 下位 3bit
 */
function applyPackedCauseToTmsCru(cause: number): void {
  const c = cause & 0x07;
  _tmsCru.ioSetInt1Cause((c & 0x06) === INT2_CAUSE_CODE.HANDSHAKE ? 1 : 0);
  if (c === INT_CAUSE_CODE.STEP) {
    _tmsCru.ioSetInt2Cause(1);
  } else {
    // ADDR_BREAK / HANDSHAKE / TIMER / クリアは INT2=0
    _tmsCru.ioSetInt2Cause(0);
  }
}

/**
 * リセット時に CPU が IO:0 から読むベクタ表の先頭を返す。
 * @returns ワードアドレス（既定は `g_reset_vector` 0x0108）
 */
export function getResetVector(): number {
  return _resetVector & 0xffff;
}

/** IO ボード側が RESET_VECTOR レジスタに書く（モニター展開後に 0x0108 を流す） */
export function setResetVector(wordAddr: number): void {
  _resetVector = wordAddr & 0xffff;
}

/**
 * ハンドシェイク信号バスを登録する（0x20〜0x24 の委譲先）。
 * @param bus 接続するバス。null で切り離す
 */
export function attachHandshakeBus(bus: CpuIoSignals | null): void {
  _handshakeBus = bus;
  _hshkBridge = bus ? createHandshakeIoPortBridge(bus) : null;
  syncBusToTmsCru();
}

/**
 * CPU 側で使うハンドシェイク配線モードを切り替える。
 * 1=MN1613（既定）/ 2=TMS9995（CRU）。
 */
export function setCpuPortMode(cpuType: number): void {
  _cpuPortMode =
    cpuType === CPU_PORT_MODE.TMS9995
      ? CPU_PORT_MODE.TMS9995
      : CPU_PORT_MODE.MN1613;
  if (_cpuPortMode === CPU_PORT_MODE.TMS9995) {
    syncBusToTmsCru();
  }
}

/** 現在の CPU 配線モード（1=MN1613 / 2=TMS9995）を返す。 */
export function getCpuPortMode(): number {
  return _cpuPortMode;
}

/**
 * 割り込み要因を IO ボード側から設定する。
 * MN1613: IO:0021 のパック値。TMS9995: CRU INT1/INT2 に分解。
 * @param cause ポート値（下位 3bit のみ有効）
 */
export function setIntCause(cause: number): void {
  _intCause = cause & 0x07;
  if (_cpuPortMode === CPU_PORT_MODE.TMS9995) {
    applyPackedCauseToTmsCru(_intCause);
    syncTmsCruToBus();
  }
  if (_handshakeBus) {
    _handshakeBus.INT_CAUSE = _intCause as CpuIoSignals["INT_CAUSE"];
  }
}

/**
 * 割り込み処理中フラグ（IO:0020 Bit0）の現在値を返す。
 * CPU の割り込みハンドラが立てている間は 1。
 * @returns 0 または 1
 */
export function getInterruptBusy(): number {
  if (_cpuPortMode === CPU_PORT_MODE.TMS9995) {
    return _tmsCru.ioReadSignal("INTERRUPT_BUSY");
  }
  return _handshakeBus ? _handshakeBus.INTERRUPT_BUSY : _interruptBusy;
}

/**
 * ハンドシェイク転送中（REQ/DENA/DACK のいずれかが 1）かどうかを返す。
 * バス未接続時は常に false。
 * @returns 転送中なら true
 */
export function isHandshakeActive(): boolean {
  if (_cpuPortMode === CPU_PORT_MODE.TMS9995) {
    const snap = _tmsCru.snapshot();
    return (
      snap.cpuOutSignals.HSHK_OUT_REQ === 1 ||
      snap.cpuOutSignals.HSHK_OUT_DENA === 1 ||
      snap.cpuOutSignals.HSHK_IN_DACK === 1 ||
      snap.cpuInSignals.HSHK_IN_REQ === 1 ||
      snap.cpuInSignals.HSHK_IN_DENA === 1 ||
      snap.cpuInSignals.HSHK_OUT_DACK === 1
    );
  }
  if (!_handshakeBus) return false;
  return (
    _handshakeBus.HSHK_OUT_REQ === 1 ||
    _handshakeBus.HSHK_OUT_DENA === 1 ||
    _handshakeBus.HSHK_IN_DACK === 1 ||
    _handshakeBus.HSHK_IN_REQ === 1 ||
    _handshakeBus.HSHK_IN_DENA === 1 ||
    _handshakeBus.HSHK_OUT_DACK === 1
  );
}

/**
 * TMS9995 CPU コア用: CRU 1bit 書き込み。
 * モードが TMS9995 のときのみ有効（MN1613 モードでは no-op）。
 * @param bitAddr CRU ビットアドレス
 * @param value 0/1
 */
export function tms9995CpuWriteCruBit(bitAddr: number, value: 0 | 1): void {
  if (_cpuPortMode !== CPU_PORT_MODE.TMS9995) return;
  const addr = bitAddr & 0xffff;
  if (addr >= 0x0010 && addr <= 0x0027) {
    _tmsCru.writeBit("cpu", addr, value);
    const snap = _tmsCru.snapshot();
    _interruptBusy = snap.cpuOutSignals.INTERRUPT_BUSY;
    _intCause =
      (snap.cpuInSignals.INT1_CAUSE | (snap.cpuInSignals.INT2_CAUSE << 1)) &
      0x07;
    syncTmsCruToBus();
    return;
  }
  if (addr === 0x1ee0 || addr === 0x1ee1) {
    notifyCruFlagWrite(addr, value);
  }
}

/**
 * TMS9995 CPU コア用: CRU 1bit 読み出し。
 * モードが TMS9995 以外なら 0 を返す。
 * @param bitAddr CRU ビットアドレス
 * @returns 0/1
 */
export function tms9995CpuReadCruBit(bitAddr: number): 0 | 1 {
  if (_cpuPortMode !== CPU_PORT_MODE.TMS9995) return 0;
  const addr = bitAddr & 0xffff;
  if (addr >= 0x0010 && addr <= 0x0027) {
    const bit = _tmsCru.readBit("cpu", addr);
    syncTmsCruToBus();
    return bit;
  }
  if (addr === 0x1ee1) {
    return readCruTimerFlagBit(addr);
  }
  return 0;
}

/**
 * TMS9995: HSHK_OUT_DATA へ 8bit（LDCR #8 相当）。
 * @param value 0..255
 */
export function tms9995CpuWriteCruDataByte(value: number): void {
  if (_cpuPortMode !== CPU_PORT_MODE.TMS9995) return;
  _tmsCru.cpuWriteOutDataByte(value & 0xff);
  syncTmsCruToBus();
}

/**
 * TMS9995: HSHK_IN_DATA を 8bit 読む（STCR #8 相当）。
 * @returns 0..255。非 TMS モードは 0
 */
export function tms9995CpuReadCruDataByte(): number {
  if (_cpuPortMode !== CPU_PORT_MODE.TMS9995) return 0;
  const v = _tmsCru.cpuReadInDataByte();
  syncTmsCruToBus();
  return v;
}

/**
 * TMS9995: FE80–FEFF メモリマップド IO のリード。
 * @param addr バイトアドレス
 * @returns 下位 8bit。領域外または非 TMS は null
 */
export function tms9995MemReadIoByte(addr: number): number | null {
  if (_cpuPortMode !== CPU_PORT_MODE.TMS9995) return null;
  return tms9995IoMmap.readByte(addr);
}

/**
 * TMS9995: FE80–FEFF メモリマップド IO のライト。
 * @param addr バイトアドレス
 * @param value バイト値
 * @returns 処理したら true
 */
export function tms9995MemWriteIoByte(addr: number, value: number): boolean {
  if (_cpuPortMode !== CPU_PORT_MODE.TMS9995) return false;
  return tms9995IoMmap.writeByte(addr, value);
}

/**
 * アドレス比較一致時の IRQ。
 * MN1613: INT1・CAUSE=0。TMS9995: INT2・CAUSE=0。
 * @param _slot ヒットしたスロット
 */
function raiseAddrBreakIrq(_slot: number): void {
  if (_cpuPortMode === CPU_PORT_MODE.TMS9995) {
    _tmsCru.ioSetInt2Cause(0);
    syncTmsCruToBus();
    triggerInterrupt(2);
    return;
  }
  setIntCause(INT_CAUSE_CODE.ADDR_BREAK);
  triggerInterrupt(1);
}

/**
 * ステップワンショットの IRQ。
 * MN1613: INT1・CAUSE=1。TMS9995: INT2・CAUSE=1。
 */
function raiseStepBreakIrq(): void {
  if (_cpuPortMode === CPU_PORT_MODE.TMS9995) {
    _tmsCru.ioSetInt2Cause(1);
    syncTmsCruToBus();
    triggerInterrupt(2);
    return;
  }
  setIntCause(INT_CAUSE_CODE.STEP);
  triggerInterrupt(1);
}

/**
 * CPU の RD/WT コールバックを IO ボードポートに接続する。
 * MN1613: 0030〜0037。TMS9995 比較器/ステップは FE80 メモリ API 側。
 */
export function attachIoBoardPorts(): void {
  addrComparators.setOnHit(raiseAddrBreakIrq);
  stepBreak.setOnHit(raiseStepBreakIrq);
  tms9995IoMmap.setOnHit(raiseAddrBreakIrq, raiseStepBreakIrq);

  setIoReadCallback((port) => {
    const p = port & 0xffff;
    if (p === IO_PORT_RESET_VECTOR) {
      return _resetVector & 0xffff;
    }
    const breakVal = addrComparators.readPort(p);
    if (breakVal !== null) {
      return breakVal;
    }
    const stepVal = stepBreak.readPort(p);
    if (stepVal !== null) {
      return stepVal;
    }
    if (
      _hshkBridge &&
      (p === HSHK_IO_PORT.INTERRUPT_BUSY ||
        p === HSHK_IO_PORT.INT_CAUSE ||
        p === HSHK_IO_PORT.HSHK_OUT_CTRL ||
        p === HSHK_IO_PORT.HSHK_IN_CTRL ||
        p === HSHK_IO_PORT.HSHK_OUT_DATA ||
        p === HSHK_IO_PORT.HSHK_IN_DATA)
    ) {
      return _hshkBridge.read(p);
    }
    // バス未接続でも割り込み要因・処理中フラグは CPU から見える必要がある
    if (p === HSHK_IO_PORT.INTERRUPT_BUSY) return _interruptBusy;
    if (p === HSHK_IO_PORT.INT_CAUSE) return _intCause;
    return 0;
  });

  setIoWriteCallback((port, val) => {
    const p = port & 0xffff;
    if (p === IO_PORT_RESET_VECTOR) {
      _resetVector = val & 0xffff;
      return;
    }
    if (
      p === IO_PORT_BREAK_CTRL ||
      p === IO_PORT_BREAK_ADDR_LO ||
      p === IO_PORT_BREAK_ADDR_HI ||
      p === IO_PORT_BREAK_HIT ||
      p === IO_PORT_BREAK_PREV
    ) {
      addrComparators.writePort(p, val);
      return;
    }
    if (p === IO_PORT_STEP_ENA || p === IO_PORT_STEP_DELAY) {
      stepBreak.writePort(p, val);
      return;
    }
    if (_hshkBridge) {
      _hshkBridge.write(p, val);
      return;
    }
    if (p === HSHK_IO_PORT.INTERRUPT_BUSY) {
      _interruptBusy = val & 1;
    }
  });
}

/**
 * 比較器バンクとステップ・ワンショットを初期化する（リセット／テスト用）。
 * ヒット通知は attachIoBoardPorts 後も維持する。
 */
export function resetAddrComparators(): void {
  addrComparators.reset();
  addrComparators.setOnHit(raiseAddrBreakIrq);
  stepBreak.reset();
  stepBreak.setOnHit(raiseStepBreakIrq);
  tms9995IoMmap.reset();
  tms9995IoMmap.setOnHit(raiseAddrBreakIrq, raiseStepBreakIrq);
}
