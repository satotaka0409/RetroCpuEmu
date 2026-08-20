/**
 * TMS9995 の CRU ハンドシェイク領域モック。
 * 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc（0x0024..0x003F）
 */

import type {
  Tms9995CruActor,
  Tms9995CruBit,
  Tms9995CruCpuInSignal,
  Tms9995CruCpuOutSignal,
  Tms9995CruHandshakeOptions,
  Tms9995CruHandshakeSnapshot,
  Tms9995CruReadLog,
  Tms9995CruSignalName,
  Tms9995CruWriteLog,
} from "./types.js";

const BIT_MIN = 0x0024;
const BIT_MAX = 0x003f;
const OUT_DATA_START = 0x0030;
const IN_DATA_START = 0x0038;

const CPU_OUT_SIGNALS: Record<Tms9995CruCpuOutSignal, number> = {
  HSHK_OUT_REQ: 0x0024,
  HSHK_ENA: 0x0025,
  HSHK_OUT_DENA: 0x0026,
  HSHK_IN_DACK: 0x0027,
};

const CPU_IN_SIGNALS: Record<Tms9995CruCpuInSignal, number> = {
  HSHK_IN_REQ: 0x0028,
  HSHK_IN_DENA: 0x0029,
  HSHK_IN_DACK: 0x002a,
  HSHK_OUT_DACK: 0x002b,
};

const CPU_WRITABLE = new Set<number>([
  CPU_OUT_SIGNALS.HSHK_OUT_REQ,
  CPU_OUT_SIGNALS.HSHK_ENA,
  CPU_OUT_SIGNALS.HSHK_OUT_DENA,
  CPU_OUT_SIGNALS.HSHK_IN_DACK,
  ...range(OUT_DATA_START, OUT_DATA_START + 7),
]);

const IO_WRITABLE = new Set<number>([
  CPU_IN_SIGNALS.HSHK_IN_REQ,
  CPU_IN_SIGNALS.HSHK_IN_DENA,
  CPU_IN_SIGNALS.HSHK_IN_DACK,
  CPU_IN_SIGNALS.HSHK_OUT_DACK,
  ...range(IN_DATA_START, IN_DATA_START + 7),
]);

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p += 1) {
    out.push(p);
  }
  return out;
}

function toBit(value: number): Tms9995CruBit {
  return value === 0 ? 0 : 1;
}

function asByte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new Error(`byte must be 0..255 (got ${value})`);
  }
  return value;
}

function fmtBitAddr(bitAddr: number): string {
  return `0x${bitAddr.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * CRU ハンドシェイク線モック。
 * CPU 側と IO 側で役割外の読み書きを検出できる。
 */
export class Tms9995CruHandshakeMock {
  readonly writes: Tms9995CruWriteLog[] = [];
  readonly reads: Tms9995CruReadLog[] = [];

  private readonly strictRoles: boolean;
  private readonly bits = new Map<number, Tms9995CruBit>();

  constructor(options: Tms9995CruHandshakeOptions = {}) {
    this.strictRoles = options.strictRoles !== false;
    for (const bitAddr of range(BIT_MIN, BIT_MAX)) {
      this.bits.set(bitAddr, 0);
    }
  }

  /** すべての線を 0 に戻し、ログも消す。 */
  reset(): void {
    for (const bitAddr of this.bits.keys()) {
      this.bits.set(bitAddr, 0);
    }
    this.writes.length = 0;
    this.reads.length = 0;
  }

  /**
   * 1bit 書き込み。
   * @param actor 主体（cpu / io）
   * @param bitAddr CRU ビットアドレス
   * @param value 0/1
   */
  writeBit(
    actor: Tms9995CruActor,
    bitAddr: number,
    value: Tms9995CruBit,
  ): void {
    const addr = this.normalizeBitAddr(bitAddr);
    if (this.strictRoles && !this.canWrite(actor, addr)) {
      throw new Error(
        `${actor} cannot write CRU bit ${fmtBitAddr(addr)} in handshake region`,
      );
    }
    this.bits.set(addr, value);
    this.writes.push({ actor, bitAddr: addr, value });
  }

  /**
   * 1bit 読み出し。
   * @param actor 主体（cpu / io）
   * @param bitAddr CRU ビットアドレス
   * @returns 0/1
   */
  readBit(actor: Tms9995CruActor, bitAddr: number): Tms9995CruBit {
    const addr = this.normalizeBitAddr(bitAddr);
    if (this.strictRoles && !this.canRead(actor, addr)) {
      throw new Error(
        `${actor} cannot read CRU bit ${fmtBitAddr(addr)} in handshake region`,
      );
    }
    const value = this.bits.get(addr) ?? 0;
    this.reads.push({ actor, bitAddr: addr, value });
    return value;
  }

  /** CPU 出力信号を 1bit 書き込む。 */
  cpuWriteSignal(signal: Tms9995CruCpuOutSignal, value: Tms9995CruBit): void {
    this.writeBit("cpu", CPU_OUT_SIGNALS[signal], value);
  }

  /** CPU 入力信号を 1bit 読み出す。 */
  cpuReadSignal(signal: Tms9995CruCpuInSignal): Tms9995CruBit {
    return this.readBit("cpu", CPU_IN_SIGNALS[signal]);
  }

  /** IO 側が CPU 入力信号を 1bit 書き込む。 */
  ioWriteSignal(signal: Tms9995CruCpuInSignal, value: Tms9995CruBit): void {
    this.writeBit("io", CPU_IN_SIGNALS[signal], value);
  }

  /** IO 側が CPU 出力信号を 1bit 読み出す。 */
  ioReadSignal(signal: Tms9995CruCpuOutSignal): Tms9995CruBit {
    return this.readBit("io", CPU_OUT_SIGNALS[signal]);
  }

  /** CPU→IO データ線（0x0030..0x0037）へ 1 バイトを載せる。 */
  cpuWriteOutDataByte(value: number): void {
    const b = asByte(value);
    for (let i = 0; i < 8; i += 1) {
      this.writeBit("cpu", OUT_DATA_START + i, toBit((b >> i) & 1));
    }
  }

  /** IO 側が CPU→IO データ線（0x0030..0x0037）を 1 バイトとして読む。 */
  ioReadOutDataByte(): number {
    return this.readByte("io", OUT_DATA_START);
  }

  /** IO→CPU データ線（0x0038..0x003F）へ 1 バイトを載せる。 */
  ioWriteInDataByte(value: number): void {
    const b = asByte(value);
    for (let i = 0; i < 8; i += 1) {
      this.writeBit("io", IN_DATA_START + i, toBit((b >> i) & 1));
    }
  }

  /** CPU 側が IO→CPU データ線（0x0038..0x003F）を 1 バイトとして読む。 */
  cpuReadInDataByte(): number {
    return this.readByte("cpu", IN_DATA_START);
  }

  /** 任意の信号アドレスを名前で引く（テスト用）。 */
  bitAddrOf(signal: Tms9995CruSignalName): number {
    if (signal in CPU_OUT_SIGNALS) {
      const key = signal as Tms9995CruCpuOutSignal;
      return CPU_OUT_SIGNALS[key];
    }
    const key = signal as Tms9995CruCpuInSignal;
    return CPU_IN_SIGNALS[key];
  }

  /** 現在の線状態を取り出す。 */
  snapshot(): Tms9995CruHandshakeSnapshot {
    const cpuOutSignals = {
      HSHK_OUT_REQ: this.peekBit(CPU_OUT_SIGNALS.HSHK_OUT_REQ),
      HSHK_ENA: this.peekBit(CPU_OUT_SIGNALS.HSHK_ENA),
      HSHK_OUT_DENA: this.peekBit(CPU_OUT_SIGNALS.HSHK_OUT_DENA),
      HSHK_IN_DACK: this.peekBit(CPU_OUT_SIGNALS.HSHK_IN_DACK),
    };
    const cpuInSignals = {
      HSHK_IN_REQ: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_REQ),
      HSHK_IN_DENA: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_DENA),
      HSHK_IN_DACK: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_DACK),
      HSHK_OUT_DACK: this.peekBit(CPU_IN_SIGNALS.HSHK_OUT_DACK),
    };
    const bits: Record<string, Tms9995CruBit> = {};
    for (const bitAddr of range(BIT_MIN, BIT_MAX)) {
      bits[fmtBitAddr(bitAddr)] = this.peekBit(bitAddr);
    }
    return {
      cpuOutSignals,
      cpuInSignals,
      outDataByte: this.peekByte(OUT_DATA_START),
      inDataByte: this.peekByte(IN_DATA_START),
      bits,
    };
  }

  private readByte(actor: Tms9995CruActor, fromBitAddr: number): number {
    let out = 0;
    for (let i = 0; i < 8; i += 1) {
      const bit = this.readBit(actor, fromBitAddr + i);
      out |= bit << i;
    }
    return out;
  }

  private peekByte(fromBitAddr: number): number {
    let out = 0;
    for (let i = 0; i < 8; i += 1) {
      out |= this.peekBit(fromBitAddr + i) << i;
    }
    return out;
  }

  private peekBit(bitAddr: number): Tms9995CruBit {
    return this.bits.get(bitAddr) ?? 0;
  }

  private normalizeBitAddr(bitAddr: number): number {
    if (!Number.isInteger(bitAddr)) {
      throw new Error(`bit address must be integer (got ${String(bitAddr)})`);
    }
    if (bitAddr < BIT_MIN || bitAddr > BIT_MAX) {
      throw new Error(
        `bit address ${fmtBitAddr(bitAddr)} is out of handshake region (${fmtBitAddr(
          BIT_MIN,
        )}..${fmtBitAddr(BIT_MAX)})`,
      );
    }
    return bitAddr;
  }

  private canWrite(actor: Tms9995CruActor, bitAddr: number): boolean {
    return actor === "cpu"
      ? CPU_WRITABLE.has(bitAddr)
      : IO_WRITABLE.has(bitAddr);
  }

  private canRead(actor: Tms9995CruActor, bitAddr: number): boolean {
    return actor === "cpu"
      ? IO_WRITABLE.has(bitAddr)
      : CPU_WRITABLE.has(bitAddr);
  }
}

/** ハンドシェイク CRU 領域の範囲（両端含む）。 */
export const TMS9995_CRU_HANDSHAKE_REGION = {
  bitAddrMin: BIT_MIN,
  bitAddrMax: BIT_MAX,
  outDataStart: OUT_DATA_START,
  inDataStart: IN_DATA_START,
} as const;

/** 役割名と CRU ビットアドレスの対応。 */
export const TMS9995_CRU_HANDSHAKE_SIGNALS = {
  ...CPU_OUT_SIGNALS,
  ...CPU_IN_SIGNALS,
} as const;
