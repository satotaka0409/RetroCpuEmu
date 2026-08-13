/**
 * CPU ↔ IO ボード間の共有制御（Worker 間 SharedArrayBuffer）
 *
 * RAM は CPU ボード専有。ここには載せない。
 * - control: DMA_BUSY など
 * - status: CPU が毎ティック書くミラー（IO が UI 用に読む）
 */

/** CPU RAM バイト数（CPU Worker 内。DMA HEX 用に IO も知る） */
export const MEM_BYTES = 0x40000 * 2;

/** control Int32 スロット */
export const CTRL = {
  DMA_BUSY: 0,
  CPU_TO_IO_REQ: 1,
  /** 1 = CPU ワーカ稼働中 */
  CPU_RUNNING: 2,
  /** 1 = IO ワーカ稼働中 */
  IO_RUNNING: 3,
} as const;

/** status Int32 スロット（CPU → IO ミラー） */
export const STATUS = {
  FRAME: 0,
  EXEC: 1, // 0 idle 1 running 2 halted 3 breakpoint
  HLT: 2,
  RUN: 3,
  RST: 4,
  IRQ0: 5,
  IRQ1: 6,
  IRQ2: 7,
  STR: 8,
  R0: 9,
  IC: 10,
  SP: 11,
  CSBR: 12,
  SSBR: 13,
  TSR0: 14,
  TSR1: 15,
  NPP: 16,
  IISR: 17,
  SBRB: 18,
  ICB: 19,
  R1: 20,
  R2: 21,
  R3: 22,
  R4: 23,
  OSR0: 24,
  OSR1: 25,
  OSR2: 26,
  OSR3: 27,
  /** リセットからの CPU クロック下位 32bit（unsigned） */
  CLOCK_LO: 28,
  /** リセットからの CPU クロック上位 32bit（unsigned） */
  CLOCK_HI: 29,
} as const;

export const EXEC_CODE = {
  idle: 0,
  running: 1,
  halted: 2,
  breakpoint: 3,
} as const;

export type SharedBoard = {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
  ctrl: Int32Array;
  stat: Int32Array;
};

/**
 * CPU / IO Worker 間で共有する制御・状態バッファを新規に作る。
 * @returns SharedArrayBuffer とその Int32Array ビュー
 */
export function createSharedBoard(): SharedBoard {
  const control = new SharedArrayBuffer(64 * 4);
  const status = new SharedArrayBuffer(64 * 4);
  return {
    control,
    status,
    ctrl: new Int32Array(control),
    stat: new Int32Array(status),
  };
}

/**
 * workerData で受け取った共有バッファにビューを張り直す。
 * @param parts control / status の SharedArrayBuffer
 * @returns Worker 内で使う SharedBoard
 */
export function attachSharedBoard(parts: {
  control: SharedArrayBuffer;
  status: SharedArrayBuffer;
}): SharedBoard {
  return {
    control: parts.control,
    status: parts.status,
    ctrl: new Int32Array(parts.control),
    stat: new Int32Array(parts.status),
  };
}

/**
 * 64bit クロックを SharedArrayBuffer 用の 2×int32 にする。
 * @param clock 0〜2^64-1
 * @returns hi/lo（各 32bit。Atomics.store 向けに符号付き int32）
 */
export function clockCountToHiLo(clock: bigint): { hi: number; lo: number } {
  const c = clock & 0xffff_ffff_ffff_ffffn;
  return {
    lo: Number(c & 0xffffffffn) | 0,
    hi: Number((c >> 32n) & 0xffffffffn) | 0,
  };
}

/**
 * SharedArrayBuffer の hi/lo から 64bit クロックを復元する。
 * @param hi 上位 32bit（Atomics.load の戻り）
 * @param lo 下位 32bit
 * @returns 0〜2^64-1
 */
export function clockCountFromHiLo(hi: number, lo: number): bigint {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}
