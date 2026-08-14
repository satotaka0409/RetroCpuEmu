/**
 * テスト用メモリ初期化の 16bit M系列（Galois LFSR）。
 * bios_common.asm の g_get_rnd と同じ多項式 x^16+x^14+x^13+x^11+1（タップ 0xB400）。
 * 種は現在時刻から作る（0 はロックするので 1 にする）。
 */

/** Galois LFSR タップ（右シフト） */
export const MEM_MSEQ_TAP = 0xb400;

/**
 * 現在時刻から 16bit の M系列種を作る。0 にはしない。
 * @returns 1〜0xFFFF
 */
export function memMseqSeedFromTime(): number {
  const ns = process.hrtime.bigint();
  const ms = BigInt(Date.now());
  const mixed = Number((ns ^ (ms << 20n) ^ (ms >> 4n)) & 0xffffn);
  return mixed === 0 ? 1 : mixed;
}

/**
 * bios_common.asm と同じ右シフト Galois LFSR を 1 歩進める。
 * @param seed 種（16bit。0 は 1 にする）
 * @returns 次の値（1〜0xFFFF）
 */
export function mseqStep(seed: number): number {
  let x = seed & 0xffff;
  if (x === 0) {
    x = 1;
  }
  const lsb = x & 1;
  x >>>= 1;
  if (lsb !== 0) {
    x ^= MEM_MSEQ_TAP;
  }
  return x & 0xffff;
}

/**
 * 種を 16bit にし、0 なら 1 にする。
 * @param seed 任意の種
 * @returns 1〜0xFFFF
 */
function normalizeSeed(seed: number): number {
  const x = seed & 0xffff;
  return x === 0 ? 1 : x;
}

/**
 * バッファを 16bit ビッグエンディアンの M系列で埋める。
 * 物理ワード i には種から i+1 歩進めた値を書く。
 * @param buf 偶数バイト長のメモリ
 * @param seed 開始種。省略時は現在時刻から作る。0 は 1 にする
 * @returns 実際に使った種（1〜0xFFFF）
 */
export function fillMemoryMSequence(buf: ArrayBuffer, seed?: number): number {
  const start = normalizeSeed(seed ?? memMseqSeedFromTime());
  const bytes = new Uint8Array(buf);
  const words = buf.byteLength >>> 1;
  let x = start;
  let off = 0;
  for (let i = 0; i < words; i += 1) {
    x = mseqStep(x);
    bytes[off] = (x >>> 8) & 0xff;
    bytes[off + 1] = x & 0xff;
    off += 2;
  }
  return start;
}

/**
 * M系列で埋めたメモリを返す。種は省略時に現在時刻から決める。
 * @param byteLength バイト数（既定セッションは 256K ワード＝512KB）
 * @param seed 開始種。省略時は現在時刻
 * @returns buffer と実際の種
 */
export function createMSequenceMemory(
  byteLength: number,
  seed?: number,
): { buffer: ArrayBuffer; seed: number } {
  const buffer = new ArrayBuffer(byteLength);
  const used = fillMemoryMSequence(buffer, seed);
  return { buffer, seed: used };
}
