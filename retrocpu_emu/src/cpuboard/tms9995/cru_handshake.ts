/**
 * TMS9995 CRU ハンドシェイク領域（0x0020..0x003F）エミュレーション。
 *
 * 仕様根拠:
 * - TMS9995_CPUボードメモリ_IOマップ.mdc
 * - HandShake.mdc
 *
 * 方向制約:
 * - CPU出力: HSHK_OUT_REQ / HSHK_OUT_DENA / HSHK_IN_DACK / INTERRUPT_BUSY
 * - CPU入力: HSHK_IN_REQ / HSHK_IN_DENA / HSHK_OUT_DACK / INT1_CAUSE[1:0] / INT2_CAUSE
 */

export type Tms9995CruActor = "cpu" | "io";
export type Tms9995CruBit = 0 | 1;

export type Tms9995CruCpuOutSignal =
  | "HSHK_OUT_REQ"
  | "HSHK_OUT_DENA"
  | "HSHK_IN_DACK"
  | "INTERRUPT_BUSY";

export type Tms9995CruCpuInSignal =
  | "HSHK_IN_REQ"
  | "HSHK_IN_DENA"
  | "HSHK_OUT_DACK"
  | "INT1_CAUSE0"
  | "INT1_CAUSE1"
  | "INT2_CAUSE";

export type Tms9995CruSignalName =
  | Tms9995CruCpuOutSignal
  | Tms9995CruCpuInSignal;

export type Tms9995CruWriteLog = {
  actor: Tms9995CruActor;
  bitAddr: number;
  value: Tms9995CruBit;
};

export type Tms9995CruReadLog = {
  actor: Tms9995CruActor;
  bitAddr: number;
  value: Tms9995CruBit;
};

export type Tms9995CruSnapshot = {
  cpuOutSignals: Record<Tms9995CruCpuOutSignal, Tms9995CruBit>;
  cpuInSignals: Record<Tms9995CruCpuInSignal, Tms9995CruBit>;
  outDataByte: number;
  inDataByte: number;
  bits: Record<string, Tms9995CruBit>;
};

export type Tms9995CruOptions = {
  strictRoles?: boolean;
};

const BIT_MIN = 0x0020;
const BIT_MAX = 0x003f;
const OUT_DATA_START = 0x0030;
const IN_DATA_START = 0x0038;

const IRQ_BITS = {
  INTERRUPT_BUSY: 0x0020,
  INT1_CAUSE0: 0x0021,
  INT1_CAUSE1: 0x0022,
  INT2_CAUSE: 0x0023,
} as const;

const CPU_OUT_SIGNALS: Record<Tms9995CruCpuOutSignal, number> = {
  HSHK_OUT_REQ: 0x0024,
  HSHK_OUT_DENA: 0x0025,
  HSHK_IN_DACK: 0x0026,
  INTERRUPT_BUSY: IRQ_BITS.INTERRUPT_BUSY,
};

const CPU_IN_SIGNALS: Record<Tms9995CruCpuInSignal, number> = {
  HSHK_IN_REQ: 0x0028,
  HSHK_IN_DENA: 0x0029,
  HSHK_OUT_DACK: 0x002a,
  INT1_CAUSE0: IRQ_BITS.INT1_CAUSE0,
  INT1_CAUSE1: IRQ_BITS.INT1_CAUSE1,
  INT2_CAUSE: IRQ_BITS.INT2_CAUSE,
};

const CPU_WRITABLE = new Set<number>([
  CPU_OUT_SIGNALS.HSHK_OUT_REQ,
  CPU_OUT_SIGNALS.HSHK_OUT_DENA,
  CPU_OUT_SIGNALS.HSHK_IN_DACK,
  CPU_OUT_SIGNALS.INTERRUPT_BUSY,
  ...range(OUT_DATA_START, OUT_DATA_START + 7),
]);

const IO_WRITABLE = new Set<number>([
  CPU_IN_SIGNALS.HSHK_IN_REQ,
  CPU_IN_SIGNALS.HSHK_IN_DENA,
  CPU_IN_SIGNALS.HSHK_OUT_DACK,
  CPU_IN_SIGNALS.INT1_CAUSE0,
  CPU_IN_SIGNALS.INT1_CAUSE1,
  CPU_IN_SIGNALS.INT2_CAUSE,
  ...range(IN_DATA_START, IN_DATA_START + 7),
]);

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p += 1) out.push(p);
  return out;
}

function toBit(v: number): Tms9995CruBit {
  return v === 0 ? 0 : 1;
}

function asByte(v: number): number {
  if (!Number.isInteger(v) || v < 0 || v > 0xff) {
    throw new Error(`byte must be 0..255 (got ${v})`);
  }
  return v;
}

function fmt(addr: number): string {
  return `0x${addr.toString(16).toUpperCase().padStart(4, "0")}`;
}

export class Tms9995CruHandshake {
  readonly writes: Tms9995CruWriteLog[] = [];
  readonly reads: Tms9995CruReadLog[] = [];

  private readonly strictRoles: boolean;
  private readonly bits = new Map<number, Tms9995CruBit>();

  constructor(options: Tms9995CruOptions = {}) {
    this.strictRoles = options.strictRoles !== false;
    for (const b of range(BIT_MIN, BIT_MAX)) this.bits.set(b, 0);
  }

  reset(): void {
    for (const b of this.bits.keys()) this.bits.set(b, 0);
    this.writes.length = 0;
    this.reads.length = 0;
  }

  writeBit(
    actor: Tms9995CruActor,
    bitAddr: number,
    value: Tms9995CruBit,
  ): void {
    const addr = this.normalizeBitAddr(bitAddr);
    if (this.strictRoles && !this.canWrite(actor, addr)) {
      throw new Error(
        `${actor} cannot write CRU bit ${fmt(addr)} in handshake region`,
      );
    }
    this.bits.set(addr, value);
    this.writes.push({ actor, bitAddr: addr, value });
  }

  readBit(actor: Tms9995CruActor, bitAddr: number): Tms9995CruBit {
    const addr = this.normalizeBitAddr(bitAddr);
    if (this.strictRoles && !this.canRead(actor, addr)) {
      throw new Error(
        `${actor} cannot read CRU bit ${fmt(addr)} in handshake region`,
      );
    }
    const value = this.bits.get(addr) ?? 0;
    this.reads.push({ actor, bitAddr: addr, value });
    return value;
  }

  cpuWriteSignal(signal: Tms9995CruCpuOutSignal, value: Tms9995CruBit): void {
    this.writeBit("cpu", CPU_OUT_SIGNALS[signal], value);
  }

  cpuReadSignal(signal: Tms9995CruCpuInSignal): Tms9995CruBit {
    return this.readBit("cpu", CPU_IN_SIGNALS[signal]);
  }

  ioWriteSignal(signal: Tms9995CruCpuInSignal, value: Tms9995CruBit): void {
    this.writeBit("io", CPU_IN_SIGNALS[signal], value);
  }

  ioReadSignal(signal: Tms9995CruCpuOutSignal): Tms9995CruBit {
    return this.readBit("io", CPU_OUT_SIGNALS[signal]);
  }

  ioSetInt1Cause(cause: number): void {
    const c = cause & 0x3;
    this.writeBit("io", IRQ_BITS.INT1_CAUSE0, toBit(c & 1));
    this.writeBit("io", IRQ_BITS.INT1_CAUSE1, toBit((c >> 1) & 1));
  }

  cpuReadInt1Cause(): number {
    const b0 = this.readBit("cpu", IRQ_BITS.INT1_CAUSE0);
    const b1 = this.readBit("cpu", IRQ_BITS.INT1_CAUSE1);
    return b0 | (b1 << 1);
  }

  ioSetInt2Cause(cause: number): void {
    this.writeBit("io", IRQ_BITS.INT2_CAUSE, toBit(cause & 1));
  }

  cpuReadInt2Cause(): Tms9995CruBit {
    return this.readBit("cpu", IRQ_BITS.INT2_CAUSE);
  }

  cpuWriteOutDataByte(value: number): void {
    const b = asByte(value);
    for (let i = 0; i < 8; i += 1) {
      this.writeBit("cpu", OUT_DATA_START + i, toBit((b >> i) & 1));
    }
  }

  ioReadOutDataByte(): number {
    return this.readByte("io", OUT_DATA_START);
  }

  ioWriteInDataByte(value: number): void {
    const b = asByte(value);
    for (let i = 0; i < 8; i += 1) {
      this.writeBit("io", IN_DATA_START + i, toBit((b >> i) & 1));
    }
  }

  cpuReadInDataByte(): number {
    return this.readByte("cpu", IN_DATA_START);
  }

  bitAddrOf(signal: Tms9995CruSignalName): number {
    if (signal in CPU_OUT_SIGNALS) {
      const key = signal as Tms9995CruCpuOutSignal;
      return CPU_OUT_SIGNALS[key];
    }
    const key = signal as Tms9995CruCpuInSignal;
    return CPU_IN_SIGNALS[key];
  }

  snapshot(): Tms9995CruSnapshot {
    const cpuOutSignals = {
      HSHK_OUT_REQ: this.peekBit(CPU_OUT_SIGNALS.HSHK_OUT_REQ),
      HSHK_OUT_DENA: this.peekBit(CPU_OUT_SIGNALS.HSHK_OUT_DENA),
      HSHK_IN_DACK: this.peekBit(CPU_OUT_SIGNALS.HSHK_IN_DACK),
      INTERRUPT_BUSY: this.peekBit(CPU_OUT_SIGNALS.INTERRUPT_BUSY),
    };
    const cpuInSignals = {
      HSHK_IN_REQ: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_REQ),
      HSHK_IN_DENA: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_DENA),
      HSHK_OUT_DACK: this.peekBit(CPU_IN_SIGNALS.HSHK_OUT_DACK),
      INT1_CAUSE0: this.peekBit(CPU_IN_SIGNALS.INT1_CAUSE0),
      INT1_CAUSE1: this.peekBit(CPU_IN_SIGNALS.INT1_CAUSE1),
      INT2_CAUSE: this.peekBit(CPU_IN_SIGNALS.INT2_CAUSE),
    };
    const bits: Record<string, Tms9995CruBit> = {};
    for (const addr of range(BIT_MIN, BIT_MAX))
      bits[fmt(addr)] = this.peekBit(addr);
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
        `bit address ${fmt(bitAddr)} is out of handshake region (${fmt(BIT_MIN)}..${fmt(BIT_MAX)})`,
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

export const TMS9995_CRU_HANDSHAKE_REGION = {
  bitAddrMin: BIT_MIN,
  bitAddrMax: BIT_MAX,
  outDataStart: OUT_DATA_START,
  inDataStart: IN_DATA_START,
  irqBusy: IRQ_BITS.INTERRUPT_BUSY,
  int1Cause0: IRQ_BITS.INT1_CAUSE0,
  int1Cause1: IRQ_BITS.INT1_CAUSE1,
  int2Cause: IRQ_BITS.INT2_CAUSE,
} as const;

export const TMS9995_CRU_HANDSHAKE_SIGNALS = {
  ...CPU_OUT_SIGNALS,
  ...CPU_IN_SIGNALS,
} as const;
