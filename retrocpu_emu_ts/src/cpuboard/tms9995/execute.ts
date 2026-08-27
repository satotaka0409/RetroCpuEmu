/**
 * TMS9995 命令デコード／実行。
 * 根拠: TMS9995_instruction.mdc。割り込みマスクは MAME tms9995 と同様 ST 下位 4bit。
 */

import {
  readByteEa,
  readWordEa,
  resolveEa,
  writeByteEa,
  writeWordEa,
  type TmsMemOps,
} from "./addressing";
import {
  setAddFlags,
  setCompareByte,
  setCompareWord,
  setLaeByte,
  setLaeWord,
  setSubFlags,
} from "./status";
import { ST_AGT, ST_C, ST_EQ, ST_LGT, ST_OP, ST_OV, ST_X } from "./types";
import {
  tms9995CpuReadCruBit,
  tms9995CpuWriteCruBit,
  tms9995CpuReadCruDataByte,
  tms9995CpuWriteCruDataByte,
} from "../io_ports";

/** 実行コンテキスト（コアが所有する PC/WP/ST への参照） */
export type TmsExecuteCtx = {
  PC: number;
  WP: number;
  ST: number;
  /** IDLE 状態（割り込み待ち） */
  idle: boolean;
  mem: TmsMemOps;
  /** BLWP／割り込みベクタ */
  doBlwp: (vectorByteAddr: number, r11?: number) => void;
  /** 未定義／未実装命令 */
  illegal: (ir: number, pc: number) => void;
};

/**
 * 条件付きジャンプの判定。
 * @param cond 4bit 条件コード（命令 bit 11-8 の上位）
 * @param st ST
 */
function testCondition(cond: number, st: number): boolean {
  const c = (cond >>> 4) & 0x0f;
  const lgt = (st & ST_LGT) !== 0;
  const agt = (st & ST_AGT) !== 0;
  const eq = (st & ST_EQ) !== 0;
  const carry = (st & ST_C) !== 0;
  const ov = (st & ST_OV) !== 0;
  const op = (st & ST_OP) !== 0;
  switch (c) {
    case 0x0:
      return true; // JMP
    case 0x2:
      return agt === false && eq === false; // JLT
    case 0x3:
      return lgt === false || eq; // JLE
    case 0x4:
      return eq; // JEQ
    case 0x5:
      return lgt || eq; // JHE
    case 0x6:
      return agt; // JGT
    case 0x7:
      return !eq; // JNE
    case 0x8:
      return !carry; // JNC
    case 0x9:
      return carry; // JOC
    case 0xa:
      return !ov; // JNO
    case 0xb:
      return lgt === false && eq === false; // JL
    case 0xc:
      return lgt && !eq; // JH
    case 0xd:
      return op; // JOP
    default:
      return false;
  }
}

/**
 * Format1 デュアルオペランドを実行する。
 * @param ctx 実行コンテキスト
 * @param ir 命令語
 * @param byteOp バイト命令なら true
 * @param op 演算種別
 */
function format1(
  ctx: TmsExecuteCtx,
  ir: number,
  byteOp: boolean,
  op: string,
): void {
  const dd = (ir >>> 10) & 3;
  const ss = (ir >>> 4) & 3;
  const dReg = (ir >>> 6) & 0x0f;
  const sReg = ir & 0x0f;
  const dst = resolveEa(ctx.mem, dd, dReg, byteOp);
  const src = resolveEa(ctx.mem, ss, sReg, byteOp);

  if (byteOp) {
    const d = readByteEa(ctx.mem, dst);
    const s = readByteEa(ctx.mem, src);
    let r = d;
    switch (op) {
      case "A":
        r = (d + s) & 0xff;
        ctx.ST = setAddFlags(ctx.ST, d, s, r);
        ctx.ST = setLaeByte(ctx.ST, r);
        writeByteEa(ctx.mem, dst, r);
        break;
      case "S":
        r = (d - s) & 0xff;
        ctx.ST = setSubFlags(ctx.ST, d, s, r);
        ctx.ST = setLaeByte(ctx.ST, r);
        writeByteEa(ctx.mem, dst, r);
        break;
      case "SOC":
        r = (d | s) & 0xff;
        ctx.ST = setLaeByte(ctx.ST, r);
        writeByteEa(ctx.mem, dst, r);
        break;
      case "SZC":
        r = d & ~s & 0xff;
        ctx.ST = setLaeByte(ctx.ST, r);
        writeByteEa(ctx.mem, dst, r);
        break;
      case "C":
        ctx.ST = setCompareByte(ctx.ST, d, s);
        break;
      case "MOV":
        ctx.ST = setLaeByte(ctx.ST, s);
        writeByteEa(ctx.mem, dst, s);
        break;
      default:
        ctx.illegal(ir, ctx.PC - 2);
    }
    return;
  }

  const d = readWordEa(ctx.mem, dst);
  const s = readWordEa(ctx.mem, src);
  let r = d;
  switch (op) {
    case "A":
      r = (d + s) & 0xffff;
      ctx.ST = setAddFlags(ctx.ST, d, s, r);
      writeWordEa(ctx.mem, dst, r);
      break;
    case "S":
      r = (d - s) & 0xffff;
      ctx.ST = setSubFlags(ctx.ST, d, s, r);
      writeWordEa(ctx.mem, dst, r);
      break;
    case "SOC":
      r = (d | s) & 0xffff;
      ctx.ST = setLaeWord(ctx.ST, r);
      writeWordEa(ctx.mem, dst, r);
      break;
    case "SZC":
      r = d & ~s & 0xffff;
      ctx.ST = setLaeWord(ctx.ST, r);
      writeWordEa(ctx.mem, dst, r);
      break;
    case "C":
      ctx.ST = setCompareWord(ctx.ST, d, s);
      break;
    case "MOV":
      ctx.ST = setLaeWord(ctx.ST, s);
      writeWordEa(ctx.mem, dst, s);
      break;
    default:
      ctx.illegal(ir, ctx.PC - 2);
  }
}

/**
 * シフト／ロー�テート（Format5）。
 * @param ctx 実行コンテキスト
 * @param ir 命令語
 * @param kind SRA/SRL/SLA/SRC
 */
/**
 * 符号付き 32bit 被除数と除数で DIVS オーバーフロー判定（MAME alu_divide_signed 準拠）。
 * @param w1 R0（上位 16bit）
 * @param w2 R1（下位 16bit）
 * @param divisor 除数 16bit
 */
function divsOverflow(w1: number, w2: number, divisor: number): boolean {
  const divs = (divisor << 16) >> 16;
  const dividend = (w1 << 16) | (w2 & 0xffff) | 0;
  if (divs === 0) return true;
  if (dividend >= 0) {
    if (divs > 0) return dividend > (divs << 15) - 1;
    return dividend > (-divs << 15) + -divs - 1;
  }
  const nd = -dividend;
  if (divs > 0) return nd > (divs << 15) + divs - 1;
  return nd > (-divs << 15) - 1;
}

/**
 * 符号なし 32bit 被除数で DIV オーバーフロー判定（MAME alu_divide 準拠）。
 * @param hi R0
 * @param lo R1
 * @param divisor 除数 16bit
 */
function divOverflow(hi: number, _lo: number, divisor: number): boolean {
  if ((divisor & 0xffff) === 0) return true;
  return (hi & 0xffff) >= (divisor & 0xffff);
}

function shiftOp(ctx: TmsExecuteCtx, ir: number, kind: string): void {
  const reg = ir & 0x0f;
  let cnt = (ir >>> 4) & 0x0f;
  if (cnt === 0) {
    cnt = (ctx.mem.readReg(0) >>> 12) & 0x0f;
    if (cnt === 0) cnt = 16;
  }
  let v = ctx.mem.readReg(reg) & 0xffff;
  let carry = false;
  let overflow = false;
  const sign = (v & 0x8000) !== 0;
  for (let i = 0; i < cnt; i += 1) {
    switch (kind) {
      case "SRA":
        carry = (v & 1) !== 0;
        v = ((v >>> 1) | (sign ? 0x8000 : 0)) & 0xffff;
        break;
      case "SRL":
        carry = (v & 1) !== 0;
        v = (v >>> 1) & 0xffff;
        break;
      case "SLA":
        carry = (v & 0x8000) !== 0;
        v = (v << 1) & 0xffff;
        if (carry !== ((v & 0x8000) !== 0)) overflow = true;
        break;
      case "SRC":
        carry = (v & 1) !== 0;
        v = ((v >>> 1) | (carry ? 0x8000 : 0)) & 0xffff;
        break;
      default:
        break;
    }
  }
  ctx.ST = setLaeWord(ctx.ST, v);
  ctx.ST = carry ? ctx.ST | ST_C : ctx.ST & ~ST_C;
  if (kind === "SLA") {
    ctx.ST = overflow ? ctx.ST | ST_OV : ctx.ST & ~ST_OV;
  }
  ctx.mem.writeReg(reg, v);
}

/**
 * CRU ビットアドレス（R12 + 符号付き変位）。
 * @param ctx 実行コンテキスト
 * @param disp8 命令内 8bit 変位（ビット単位）
 */
function cruAddr(ctx: TmsExecuteCtx, disp8: number): number {
  const d = (disp8 << 24) >> 24;
  return (ctx.mem.readReg(12) + d) & 0xffff;
}

/** ハンドシェイク CRU 領域（0010–0027）。HandShake.mdc / interrupt_io.inc */
const CRU_HSHK_MIN = 0x0010;
const CRU_HSHK_MAX = 0x0027;
const CRU_HSHK_OUT_DATA = 0x0023;
const CRU_HSHK_IN_DATA = 0x0027;

/**
 * 連続 CRU ビット列がハンドシェイク領域内に収まるか。
 * @param base R12 起点（CRU ビットアドレス）
 * @param bits 転送ビット数
 */
function inHandshakeCruRange(base: number, bits: number): boolean {
  return base >= CRU_HSHK_MIN && base + bits - 1 <= CRU_HSHK_MAX;
}

/**
 * LDCR/STCR を実行する（TI: LDCR=R→CRU、STCR=CRU→R。BIOS handshake_common.asm 準拠）。
 * @param ctx 実行コンテキスト
 * @param ir 命令語
 * @param isStcr true=STCR（CRU→レジスタ）
 */
function cruTransfer(ctx: TmsExecuteCtx, ir: number, isStcr: boolean): void {
  let bits = (ir >>> 6) & 0x0f;
  if (bits === 0) bits = 16;
  const ss = (ir >>> 4) & 3;
  const sReg = ir & 0x0f;
  const src = resolveEa(ctx.mem, ss, sReg, bits <= 8);
  const base = ctx.mem.readReg(12) & 0xffff;

  if (isStcr) {
    if (base === CRU_HSHK_IN_DATA && bits === 8) {
      const b = tms9995CpuReadCruDataByte();
      writeByteEa(ctx.mem, src, b);
      ctx.ST = setLaeByte(ctx.ST, b);
      return;
    }
    if (bits <= 8) {
      let b = 0;
      if (inHandshakeCruRange(base, bits)) {
        for (let i = 0; i < bits; i += 1) {
          const bit = tms9995CpuReadCruBit(base + i);
          b = (b | (bit << i)) & 0xff;
        }
      }
      writeByteEa(ctx.mem, src, b);
      ctx.ST = setLaeByte(ctx.ST, b);
    } else {
      let w = 0;
      if (inHandshakeCruRange(base, 16)) {
        for (let i = 0; i < 16; i += 1) {
          const bit = tms9995CpuReadCruBit(base + i);
          w = (w | (bit << i)) & 0xffff;
        }
      }
      writeWordEa(ctx.mem, src, w);
      ctx.ST = setLaeWord(ctx.ST, w);
    }
    return;
  }

  if (base === CRU_HSHK_OUT_DATA && bits === 8) {
    const b = readByteEa(ctx.mem, src) & 0xff;
    tms9995CpuWriteCruDataByte(b);
    return;
  }
  if (bits <= 8) {
    const b = readByteEa(ctx.mem, src) & 0xff;
    for (let i = 0; i < bits; i += 1) {
      tms9995CpuWriteCruBit(base + i, ((b >> i) & 1) as 0 | 1);
    }
  } else {
    const w = readWordEa(ctx.mem, src) & 0xffff;
    for (let i = 0; i < 16; i += 1) {
      tms9995CpuWriteCruBit(base + i, ((w >> i) & 1) as 0 | 1);
    }
  }
}

/**
 * 1 命令を実行する（PC はフェッチ後に +2 済み想定）。
 * @param ctx 実行コンテキスト
 * @param ir 命令語
 */
export function executeInstruction(ctx: TmsExecuteCtx, ir: number): void {
  const hi = ir & 0xff00;

  // Format 8 immediate / workspace
  if (hi === 0x0200) {
    const r = ir & 0x0f;
    const imm = ctx.mem.fetchWord();
    switch (ir & 0x00f0) {
      case 0x000:
        ctx.mem.writeReg(r, imm);
        ctx.ST = setLaeWord(ctx.ST, imm);
        return;
      case 0x020: {
        const old = ctx.mem.readReg(r) & 0xffff;
        const nv = (old + imm) & 0xffff;
        ctx.mem.writeReg(r, nv);
        ctx.ST = setAddFlags(ctx.ST, old, imm, nv);
        return;
      }
      case 0x040:
        ctx.mem.writeReg(r, ctx.mem.readReg(r) & imm);
        ctx.ST = setLaeWord(ctx.ST, ctx.mem.readReg(r));
        return;
      case 0x060:
        ctx.mem.writeReg(r, ctx.mem.readReg(r) | imm);
        ctx.ST = setLaeWord(ctx.ST, ctx.mem.readReg(r));
        return;
      case 0x080:
        ctx.ST = setCompareWord(ctx.ST, ctx.mem.readReg(r), imm);
        return;
      case 0x0a0:
        ctx.mem.writeReg(r, ctx.WP);
        return;
      case 0x0c0:
        ctx.mem.writeReg(r, ctx.ST);
        return;
      case 0x0e0:
        ctx.WP = imm & 0xfffe;
        return;
      default:
        ctx.illegal(ir, ctx.PC - 2);
        return;
    }
  }

  if (hi === 0x0080) {
    ctx.ST = ctx.mem.readReg(ir & 0x0f) & 0xffff;
    return;
  }
  if (hi === 0x0090) {
    ctx.WP = ctx.mem.readReg(ir & 0x0f) & 0xfffe;
    return;
  }

  if (ir === 0x0300) {
    const imm = ctx.mem.fetchWord();
    ctx.ST = (ctx.ST & 0xfff0) | (imm & 0x000f);
    return;
  }
  if (ir === 0x0340) {
    ctx.idle = true;
    return;
  }
  if (ir === 0x0360) {
    ctx.ST &= 0xfff0;
    return;
  }
  if (ir === 0x0380) {
    ctx.ST = ctx.mem.readReg(15) & 0xffff;
    ctx.PC = ctx.mem.readReg(14) & 0xfffe;
    ctx.WP = ctx.mem.readReg(13) & 0xfffe;
    return;
  }

  // Format 2 jumps / CRU bit（1000–1FFF）
  if ((ir & 0xf000) === 0x1000) {
    const sub = (ir >>> 8) & 0x0f;
    if (sub >= 0x0d && sub <= 0x0f) {
      const addr = cruAddr(ctx, ir & 0xff);
      if (sub === 0x0d) tms9995CpuWriteCruBit(addr, 1);
      else if (sub === 0x0e) tms9995CpuWriteCruBit(addr, 0);
      else {
        const bit = tms9995CpuReadCruBit(addr);
        ctx.ST = bit ? ctx.ST | ST_EQ : ctx.ST & ~ST_EQ;
      }
      return;
    }
    if (testCondition(ir & 0x0f00, ctx.ST)) {
      let disp = ir & 0xff;
      if (disp & 0x80) disp -= 256;
      ctx.PC = (ctx.PC + disp * 2) & 0xffff;
    }
    return;
  }

  // Format 3（2000–2FFF。3000– は Format 4/9）
  if ((ir & 0xf000) === 0x2000) {
    const dd = (ir >>> 6) & 3;
    const ss = (ir >>> 4) & 3;
    const dReg = (ir >>> 10) & 0x0f;
    const sReg = ir & 0x0f;
    const dstReg = resolveEa(ctx.mem, dd, dReg, false);
    const src = resolveEa(ctx.mem, ss, sReg, false);
    const d = readWordEa(ctx.mem, dstReg);
    const s = readWordEa(ctx.mem, src);
    const op = (ir >>> 11) & 1;
    if ((ir & 0x0c00) === 0x0800) {
      const r = (d ^ s) & 0xffff;
      writeWordEa(ctx.mem, dstReg, r);
      ctx.ST = setLaeWord(ctx.ST, r);
      return;
    }
    const masked = op === 0 ? (d & s) === s : (d | s) === d;
    ctx.ST = masked ? ctx.ST | ST_EQ : ctx.ST & ~ST_EQ;
    return;
  }

  // Format 4 CRU（3000–33ff LDCR / 3400–37ff STCR）
  if ((ir & 0xfc00) === 0x3000 || (ir & 0xfc00) === 0x3400) {
    cruTransfer(ctx, ir, (ir & 0xfc00) === 0x3400);
    return;
  }

  // Format 5 shift（0800–0BFF）
  if ((ir & 0xfc00) >= 0x0800 && (ir & 0xfc00) <= 0x0bff) {
    const kinds = ["SRA", "SRL", "SLA", "SRC"];
    shiftOp(ctx, ir, kinds[(ir >>> 10) & 3]!);
    return;
  }

  // Format 9
  if ((ir & 0xfc00) === 0x3800) {
    const ss = (ir >>> 4) & 3;
    const sReg = ir & 0x0f;
    const src = resolveEa(ctx.mem, ss, sReg, false);
    const s = readWordEa(ctx.mem, src) & 0xffff;
    const r0 = ctx.mem.readReg(0) & 0xffff;
    const prod = r0 * s;
    ctx.mem.writeReg(0, (prod >>> 16) & 0xffff);
    ctx.mem.writeReg(1, prod & 0xffff);
    return;
  }
  if ((ir & 0xfc00) === 0x3c00) {
    const ss = (ir >>> 4) & 3;
    const sReg = ir & 0x0f;
    const src = resolveEa(ctx.mem, ss, sReg, false);
    const div = readWordEa(ctx.mem, src) & 0xffff;
    const hi32 = ctx.mem.readReg(0) & 0xffff;
    const lo32 = ctx.mem.readReg(1) & 0xffff;
    if (divOverflow(hi32, lo32, div)) {
      ctx.ST |= ST_OV;
      return;
    }
    const dividend = (hi32 << 16) | lo32;
    const q = Math.floor(dividend / div) & 0xffff;
    const rem = dividend % div;
    ctx.ST &= ~ST_OV;
    ctx.mem.writeReg(0, q);
    ctx.mem.writeReg(1, rem & 0xffff);
    return;
  }
  if ((ir & 0xf800) === 0x2c00) {
    const ss = (ir >>> 4) & 3;
    const sReg = ir & 0x0f;
    const src = resolveEa(ctx.mem, ss, sReg, false);
    const ea = src.reg >= 0 ? ctx.WP + src.reg * 2 : src.addr & 0xffff;
    const xop = (ir >>> 6) & 0x0f;
    ctx.ST |= ST_X;
    ctx.doBlwp(0x0040 + xop * 4, ea);
    return;
  }

  // Format 1
  if (hi === 0xa000) {
    format1(ctx, ir, false, "A");
    return;
  }
  if (hi === 0xb000) {
    format1(ctx, ir, true, "A");
    return;
  }
  if (hi === 0x6000) {
    format1(ctx, ir, false, "S");
    return;
  }
  if (hi === 0x7000) {
    format1(ctx, ir, true, "S");
    return;
  }
  if (hi === 0x8000) {
    format1(ctx, ir, false, "C");
    return;
  }
  if (hi === 0x9000) {
    format1(ctx, ir, true, "C");
    return;
  }
  if (hi === 0xc000) {
    format1(ctx, ir, false, "MOV");
    return;
  }
  if (hi === 0xd000) {
    format1(ctx, ir, true, "MOV");
    return;
  }
  if (hi === 0xe000) {
    format1(ctx, ir, false, "SOC");
    return;
  }
  if (hi === 0xf000) {
    format1(ctx, ir, true, "SOC");
    return;
  }
  if (hi === 0x4000) {
    format1(ctx, ir, false, "SZC");
    return;
  }
  if (hi === 0x5000) {
    format1(ctx, ir, true, "SZC");
    return;
  }

  // Format 6: MPYS / DIVS（0000 0001 xxss SSSS）
  if ((ir & 0xff00) === 0x0180) {
    const ss = (ir >>> 4) & 3;
    const sReg = ir & 0x0f;
    const ea = resolveEa(ctx.mem, ss, sReg, false);
    const div = readWordEa(ctx.mem, ea) & 0xffff;
    const hi32 = ctx.mem.readReg(0) & 0xffff;
    const lo32 = ctx.mem.readReg(1) & 0xffff;
    if (divsOverflow(hi32, lo32, div)) {
      ctx.ST |= ST_OV;
      return;
    }
    const dividend = (hi32 << 16) | lo32 | 0;
    const divs = (div << 16) >> 16;
    const q = Math.trunc(dividend / divs) & 0xffff;
    const rem = dividend % divs;
    ctx.ST &= ~ST_OV;
    ctx.mem.writeReg(0, q & 0xffff);
    ctx.mem.writeReg(1, rem & 0xffff);
    return;
  }
  if ((ir & 0xff00) === 0x01c0) {
    const ss = (ir >>> 4) & 3;
    const sReg = ir & 0x0f;
    const ea = resolveEa(ctx.mem, ss, sReg, false);
    const v = (readWordEa(ctx.mem, ea) << 16) >> 16;
    const r0 = (ctx.mem.readReg(0) << 16) >> 16;
    const prod = r0 * v;
    ctx.mem.writeReg(0, (prod >>> 16) & 0xffff);
    ctx.mem.writeReg(1, prod & 0xffff);
    return;
  }

  // Format 6（0400–07FF。MAME: ir & 0xFFC0 が命令部）
  if (
    (ir & 0xc000) === 0x0000 &&
    (ir & 0xfc00) >= 0x0400 &&
    (ir & 0xfc00) < 0x0800
  ) {
    const ss = (ir >>> 4) & 3;
    const sReg = ir & 0x0f;
    const ea = resolveEa(ctx.mem, ss, sReg, false);
    const op6 = ir & 0xffc0;

    if (op6 === 0x0400) {
      ctx.doBlwp(readWordEa(ctx.mem, ea) & 0xffff);
      return;
    }
    if (op6 === 0x0440) {
      ctx.PC = readWordEa(ctx.mem, ea) & 0xfffe;
      return;
    }
    if (op6 === 0x0480) {
      const innerPc = readWordEa(ctx.mem, ea) & 0xfffe;
      const saved = ctx.PC;
      ctx.PC = innerPc;
      const inner = ctx.mem.fetchWord();
      executeInstruction(ctx, inner);
      ctx.PC = saved;
      return;
    }
    if (op6 === 0x04c0) {
      writeWordEa(ctx.mem, ea, 0);
      ctx.ST = setLaeWord(ctx.ST, 0);
      return;
    }
    if (op6 === 0x0500) {
      const v = readWordEa(ctx.mem, ea);
      const r = (0x10000 - v) & 0xffff;
      writeWordEa(ctx.mem, ea, r);
      ctx.ST = setLaeWord(ctx.ST, r);
      return;
    }
    if (op6 === 0x0540) {
      const v = ~readWordEa(ctx.mem, ea) & 0xffff;
      writeWordEa(ctx.mem, ea, v);
      ctx.ST = setLaeWord(ctx.ST, v);
      return;
    }
    if (op6 === 0x0580) {
      const v = (readWordEa(ctx.mem, ea) + 1) & 0xffff;
      writeWordEa(ctx.mem, ea, v);
      ctx.ST = setLaeWord(ctx.ST, v);
      return;
    }
    if (op6 === 0x05c0) {
      const v = (readWordEa(ctx.mem, ea) + 2) & 0xffff;
      writeWordEa(ctx.mem, ea, v);
      ctx.ST = setLaeWord(ctx.ST, v);
      return;
    }
    if (op6 === 0x0600) {
      const v = (readWordEa(ctx.mem, ea) - 1) & 0xffff;
      writeWordEa(ctx.mem, ea, v);
      ctx.ST = setLaeWord(ctx.ST, v);
      return;
    }
    if (op6 === 0x0640) {
      const v = (readWordEa(ctx.mem, ea) - 2) & 0xffff;
      writeWordEa(ctx.mem, ea, v);
      ctx.ST = setLaeWord(ctx.ST, v);
      return;
    }
    if (op6 === 0x0680) {
      const target = readWordEa(ctx.mem, ea) & 0xfffe;
      ctx.mem.writeReg(11, ctx.PC);
      ctx.PC = target;
      return;
    }
    if (op6 === 0x06c0) {
      const v = readWordEa(ctx.mem, ea);
      const sw = ((v & 0xff) << 8) | (v >>> 8);
      writeWordEa(ctx.mem, ea, sw);
      ctx.ST = setLaeWord(ctx.ST, sw);
      return;
    }
    if (op6 === 0x0700) {
      writeWordEa(ctx.mem, ea, 0xffff);
      ctx.ST = setLaeWord(ctx.ST, 0xffff);
      return;
    }
    if (op6 === 0x0740) {
      const raw = readWordEa(ctx.mem, ea) & 0xffff;
      ctx.ST = setLaeWord(ctx.ST, raw);
      ctx.ST = raw === 0x8000 ? ctx.ST | ST_OV : ctx.ST & ~ST_OV;
      ctx.ST &= ~ST_C;
      let v = raw;
      if ((v & 0x8000) !== 0) v = (0x10000 - v) & 0xffff;
      writeWordEa(ctx.mem, ea, v);
      ctx.ST = setLaeWord(ctx.ST, v);
      return;
    }
  }

  ctx.illegal(ir, ctx.PC - 2);
}

/** HSHK LDCR #8 / STCR #8 向けに CRU データバイト経路を公開 */
export { tms9995CpuReadCruDataByte, tms9995CpuWriteCruDataByte };
