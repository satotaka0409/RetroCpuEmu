/**
 * TMS9995 CRU ハンドシェイク／割り込み要因エミュレーション。
 *
 * 仕様根拠: TMS9995_CPUボードメモリ_IOマップ.mdc
 *
 * | CRU | 信号 | 方向 |
 * | 0010 | INTERRUPT_BUSY | OUT |
 * | 0011 | INT1_CAUSE | IN（1=ハンドシェイク） |
 * | 0012 | INT2_CAUSE | IN（0=ブレイク / 1=ステップ） |
 * | 0020 | HSHK_OUT_REQ | OUT |
 * | 0021 | HSHK_OUT_DENA | OUT |
 * | 0022 | HSHK_IN_DACK | OUT |
 * | 0023 | HSHK_OUT_DATA | OUT（8bit ラッチ。LDCR は本 API） |
 * | 0024 | HSHK_IN_REQ | IN |
 * | 0025 | HSHK_IN_DENA | IN |
 * | 0026 | HSHK_OUT_DACK | IN |
 * | 0027 | HSHK_IN_DATA | IN（8bit ラッチ。STCR は本 API） |
 *
 * OUT_DATA / IN_DATA は 0023 / 0027 の 8bit ラッチ。
 * LDCR/STCR 用の `writeDataByte` / `readDataByte` は制御線（0024–0026）を踏まない。
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
  | "INT1_CAUSE"
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

/** CRU ハンドシェイク領域（BUSY〜DATA） */
const BIT_MIN = 0x0010;
const BIT_MAX = 0x0027;

const IRQ_BITS = {
  INTERRUPT_BUSY: 0x0010,
  INT1_CAUSE: 0x0011,
  INT2_CAUSE: 0x0012,
} as const;

const CPU_OUT_SIGNALS: Record<Tms9995CruCpuOutSignal, number> = {
  INTERRUPT_BUSY: IRQ_BITS.INTERRUPT_BUSY,
  HSHK_OUT_REQ: 0x0020,
  HSHK_OUT_DENA: 0x0021,
  HSHK_IN_DACK: 0x0022,
};

const CPU_IN_SIGNALS: Record<Tms9995CruCpuInSignal, number> = {
  INT1_CAUSE: IRQ_BITS.INT1_CAUSE,
  INT2_CAUSE: IRQ_BITS.INT2_CAUSE,
  HSHK_IN_REQ: 0x0024,
  HSHK_IN_DENA: 0x0025,
  HSHK_OUT_DACK: 0x0026,
};

/** 8bit データラッチの CRU ベース（LDCR/STCR 用） */
const OUT_DATA_BASE = 0x0023;
const IN_DATA_BASE = 0x0027;

const CPU_WRITABLE = new Set<number>([
  CPU_OUT_SIGNALS.INTERRUPT_BUSY,
  CPU_OUT_SIGNALS.HSHK_OUT_REQ,
  CPU_OUT_SIGNALS.HSHK_OUT_DENA,
  CPU_OUT_SIGNALS.HSHK_IN_DACK,
  OUT_DATA_BASE,
]);

const IO_WRITABLE = new Set<number>([
  CPU_IN_SIGNALS.INT1_CAUSE,
  CPU_IN_SIGNALS.INT2_CAUSE,
  CPU_IN_SIGNALS.HSHK_IN_REQ,
  CPU_IN_SIGNALS.HSHK_IN_DENA,
  CPU_IN_SIGNALS.HSHK_OUT_DACK,
  IN_DATA_BASE,
]);

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

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p += 1) out.push(p);
  return out;
}

/**
 * TMS9995 ボードのハンドシェイク／要因 CRU。
 * CPU と IO で書き込み方向を分ける。
 */
export class Tms9995CruHandshake {
  readonly writes: Tms9995CruWriteLog[] = [];
  readonly reads: Tms9995CruReadLog[] = [];

  private readonly strictRoles: boolean;
  private readonly bits = new Map<number, Tms9995CruBit>();
  private outDataByte = 0;
  private inDataByte = 0;

  constructor(options: Tms9995CruOptions = {}) {
    this.strictRoles = options.strictRoles !== false;
    for (const b of range(BIT_MIN, BIT_MAX)) this.bits.set(b, 0);
  }

  /** 全線・データラッチ・ログを 0 に戻す。 */
  reset(): void {
    for (const b of this.bits.keys()) this.bits.set(b, 0);
    this.outDataByte = 0;
    this.inDataByte = 0;
    this.writes.length = 0;
    this.reads.length = 0;
  }

  /**
   * CRU 1bit 書き込み。
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
        `${actor} cannot write CRU bit ${fmt(addr)} in handshake region`,
      );
    }
    if (addr === OUT_DATA_BASE) {
      this.outDataByte = (this.outDataByte & ~1) | (value & 1);
    } else if (addr === IN_DATA_BASE) {
      this.inDataByte = (this.inDataByte & ~1) | (value & 1);
    }
    this.bits.set(addr, value);
    this.writes.push({ actor, bitAddr: addr, value });
  }

  /**
   * CRU 1bit 読み出し。
   * @param actor 主体（cpu / io）
   * @param bitAddr CRU ビットアドレス
   * @returns 0/1
   */
  readBit(actor: Tms9995CruActor, bitAddr: number): Tms9995CruBit {
    const addr = this.normalizeBitAddr(bitAddr);
    if (this.strictRoles && !this.canRead(actor, addr)) {
      throw new Error(
        `${actor} cannot read CRU bit ${fmt(addr)} in handshake region`,
      );
    }
    let value: Tms9995CruBit;
    if (addr === OUT_DATA_BASE) {
      value = toBit(this.outDataByte & 1);
    } else if (addr === IN_DATA_BASE) {
      value = toBit(this.inDataByte & 1);
    } else {
      value = this.bits.get(addr) ?? 0;
    }
    this.reads.push({ actor, bitAddr: addr, value });
    return value;
  }

  /**
   * CPU→IO 信号を名前で書く。
   * @param signal 出力信号名
   * @param value 0/1
   */
  cpuWriteSignal(signal: Tms9995CruCpuOutSignal, value: Tms9995CruBit): void {
    this.writeBit("cpu", CPU_OUT_SIGNALS[signal], value);
  }

  /**
   * CPU←IO 信号を名前で読む。
   * @param signal 入力信号名
   * @returns 0/1
   */
  cpuReadSignal(signal: Tms9995CruCpuInSignal): Tms9995CruBit {
    return this.readBit("cpu", CPU_IN_SIGNALS[signal]);
  }

  /**
   * IO→CPU 信号を名前で書く。
   * @param signal 入力信号名
   * @param value 0/1
   */
  ioWriteSignal(signal: Tms9995CruCpuInSignal, value: Tms9995CruBit): void {
    this.writeBit("io", CPU_IN_SIGNALS[signal], value);
  }

  /**
   * IO←CPU 信号を名前で読む。
   * @param signal 出力信号名
   * @returns 0/1
   */
  ioReadSignal(signal: Tms9995CruCpuOutSignal): Tms9995CruBit {
    return this.readBit("io", CPU_OUT_SIGNALS[signal]);
  }

  /**
   * INT1 要因を IO 側から設定する（1=ハンドシェイク、0=なし）。
   * @param cause 下位 1bit
   */
  ioSetInt1Cause(cause: number): void {
    this.writeBit("io", IRQ_BITS.INT1_CAUSE, toBit(cause & 1));
  }

  /**
   * INT1 要因を CPU 側から読む。
   * @returns 0 または 1
   */
  cpuReadInt1Cause(): Tms9995CruBit {
    return this.readBit("cpu", IRQ_BITS.INT1_CAUSE);
  }

  /**
   * INT2 要因を IO 側から設定する（0=ブレイク、1=ステップ）。
   * @param cause 下位 1bit
   */
  ioSetInt2Cause(cause: number): void {
    this.writeBit("io", IRQ_BITS.INT2_CAUSE, toBit(cause & 1));
  }

  /**
   * INT2 要因を CPU 側から読む。
   * @returns 0 または 1
   */
  cpuReadInt2Cause(): Tms9995CruBit {
    return this.readBit("cpu", IRQ_BITS.INT2_CAUSE);
  }

  /**
   * HSHK_OUT_DATA ラッチへ 8bit を書く（LDCR #8 相当。制御線は変更しない）。
   * @param value 0..255
   */
  cpuWriteOutDataByte(value: number): void {
    const b = asByte(value);
    this.outDataByte = b;
    this.bits.set(OUT_DATA_BASE, toBit(b & 1));
    this.writes.push({
      actor: "cpu",
      bitAddr: OUT_DATA_BASE,
      value: toBit(b & 1),
    });
  }

  /**
   * HSHK_OUT_DATA ラッチを IO 側から読む。
   * @returns 0..255
   */
  ioReadOutDataByte(): number {
    this.reads.push({
      actor: "io",
      bitAddr: OUT_DATA_BASE,
      value: toBit(this.outDataByte & 1),
    });
    return this.outDataByte & 0xff;
  }

  /**
   * HSHK_IN_DATA ラッチへ 8bit を書く（IO→CPU）。
   * @param value 0..255
   */
  ioWriteInDataByte(value: number): void {
    const b = asByte(value);
    this.inDataByte = b;
    this.bits.set(IN_DATA_BASE, toBit(b & 1));
    this.writes.push({
      actor: "io",
      bitAddr: IN_DATA_BASE,
      value: toBit(b & 1),
    });
  }

  /**
   * HSHK_IN_DATA ラッチを CPU 側から読む（STCR #8 相当）。
   * @returns 0..255
   */
  cpuReadInDataByte(): number {
    this.reads.push({
      actor: "cpu",
      bitAddr: IN_DATA_BASE,
      value: toBit(this.inDataByte & 1),
    });
    return this.inDataByte & 0xff;
  }

  /**
   * 信号名に対応する CRU ビットアドレスを返す。
   * @param signal 信号名
   * @returns CRU ビットアドレス
   */
  bitAddrOf(signal: Tms9995CruSignalName): number {
    if (signal in CPU_OUT_SIGNALS) {
      const key = signal as Tms9995CruCpuOutSignal;
      return CPU_OUT_SIGNALS[key];
    }
    const key = signal as Tms9995CruCpuInSignal;
    return CPU_IN_SIGNALS[key];
  }

  /** 現在の線状態のスナップショットを返す。 */
  snapshot(): Tms9995CruSnapshot {
    const cpuOutSignals = {
      INTERRUPT_BUSY: this.peekBit(CPU_OUT_SIGNALS.INTERRUPT_BUSY),
      HSHK_OUT_REQ: this.peekBit(CPU_OUT_SIGNALS.HSHK_OUT_REQ),
      HSHK_OUT_DENA: this.peekBit(CPU_OUT_SIGNALS.HSHK_OUT_DENA),
      HSHK_IN_DACK: this.peekBit(CPU_OUT_SIGNALS.HSHK_IN_DACK),
    };
    const cpuInSignals = {
      INT1_CAUSE: this.peekBit(CPU_IN_SIGNALS.INT1_CAUSE),
      INT2_CAUSE: this.peekBit(CPU_IN_SIGNALS.INT2_CAUSE),
      HSHK_IN_REQ: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_REQ),
      HSHK_IN_DENA: this.peekBit(CPU_IN_SIGNALS.HSHK_IN_DENA),
      HSHK_OUT_DACK: this.peekBit(CPU_IN_SIGNALS.HSHK_OUT_DACK),
    };
    const bits: Record<string, Tms9995CruBit> = {};
    for (const addr of range(BIT_MIN, BIT_MAX)) {
      if (addr === OUT_DATA_BASE) {
        bits[fmt(addr)] = toBit(this.outDataByte & 1);
      } else if (addr === IN_DATA_BASE) {
        bits[fmt(addr)] = toBit(this.inDataByte & 1);
      } else {
        bits[fmt(addr)] = this.peekBit(addr);
      }
    }
    return {
      cpuOutSignals,
      cpuInSignals,
      outDataByte: this.outDataByte & 0xff,
      inDataByte: this.inDataByte & 0xff,
      bits,
    };
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
  outDataBase: OUT_DATA_BASE,
  inDataBase: IN_DATA_BASE,
  irqBusy: IRQ_BITS.INTERRUPT_BUSY,
  int1Cause: IRQ_BITS.INT1_CAUSE,
  int2Cause: IRQ_BITS.INT2_CAUSE,
} as const;

export const TMS9995_CRU_HANDSHAKE_SIGNALS = {
  ...CPU_OUT_SIGNALS,
  ...CPU_IN_SIGNALS,
  HSHK_OUT_DATA: OUT_DATA_BASE,
  HSHK_IN_DATA: IN_DATA_BASE,
} as const;
