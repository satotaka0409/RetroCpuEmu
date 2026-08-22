/**
 * TMS9995 アドレッシング解決。
 * 根拠: TMS9995_instruction.mdc
 */

export type TmsMemOps = {
  /** 命令フェッチ用（PC から読む）。読んだあと PC は呼び出し側が進める */
  fetchWord: () => number;
  readWord: (addr: number) => number;
  writeWord: (addr: number, value: number) => void;
  readByte: (addr: number) => number;
  writeByte: (addr: number, value: number) => void;
  readReg: (n: number) => number;
  writeReg: (n: number, value: number) => void;
};

export type TmsEa = {
  /** 実効アドレス（バイト）。レジスタ直接のときは WP+2*n */
  addr: number;
  /** レジスタ直接ならレジスタ番号、否则 -1 */
  reg: number;
};

/**
 * Ts/Td フィールドから実効アドレスを求める。
 * @param ops メモリアクセス
 * @param mode 2bit
 * @param reg 4bit
 * @param isByte バイト命令なら true（(R)+ の増分が 1）
 * @returns EA
 */
export function resolveEa(
  ops: TmsMemOps,
  mode: number,
  reg: number,
  isByte: boolean,
): TmsEa {
  const m = mode & 3;
  const r = reg & 0xf;
  if (m === 0) {
    // レジスタ直接: アドレスは WP+2*r（writeReg 経路でも使う）
    return { addr: -1, reg: r };
  }
  if (m === 1) {
    return { addr: ops.readReg(r) & 0xffff, reg: -1 };
  }
  if (m === 3) {
    const a = ops.readReg(r) & 0xffff;
    ops.writeReg(r, (a + (isByte ? 1 : 2)) & 0xffff);
    return { addr: a, reg: -1 };
  }
  // m === 2: symbolic / indexed
  const imm = ops.fetchWord();
  if (r === 0) {
    return { addr: imm & 0xffff, reg: -1 };
  }
  return { addr: (imm + ops.readReg(r)) & 0xffff, reg: -1 };
}

/**
 * ワードを読む（レジスタ直接対応）。
 * @param ops メモリアクセス
 * @param ea EA
 * @returns 16bit
 */
export function readWordEa(ops: TmsMemOps, ea: TmsEa): number {
  if (ea.reg >= 0) return ops.readReg(ea.reg) & 0xffff;
  return ops.readWord(ea.addr);
}

/**
 * ワードを書く。
 * @param ops メモリアクセス
 * @param ea EA
 * @param value 16bit
 */
export function writeWordEa(ops: TmsMemOps, ea: TmsEa, value: number): void {
  if (ea.reg >= 0) ops.writeReg(ea.reg, value & 0xffff);
  else ops.writeWord(ea.addr, value & 0xffff);
}

/**
 * バイトを読む（レジスタ直接は左バイト＝MSB）。
 * @param ops メモリアクセス
 * @param ea EA
 * @returns 8bit
 */
export function readByteEa(ops: TmsMemOps, ea: TmsEa): number {
  if (ea.reg >= 0) return (ops.readReg(ea.reg) >>> 8) & 0xff;
  return ops.readByte(ea.addr);
}

/**
 * バイトを書く（レジスタ直接は左バイトを更新）。
 * @param ops メモリアクセス
 * @param ea EA
 * @param value 8bit
 */
export function writeByteEa(ops: TmsMemOps, ea: TmsEa, value: number): void {
  const v = value & 0xff;
  if (ea.reg >= 0) {
    const w = ops.readReg(ea.reg) & 0xffff;
    ops.writeReg(ea.reg, ((v << 8) | (w & 0x00ff)) & 0xffff);
    return;
  }
  ops.writeByte(ea.addr, v);
}
