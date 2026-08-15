/**
 * GPR 専用命令にセグメント／特殊レジスタを書いたときの診断。
 * 根拠: retrocpu_asm `parseReg`（REG_MAP = R0–R4/SP/STR）。OSR0 等は CPYB/CPYS/CPYH。
 * アドレッシングは `addressingModes.ts`（parseEA / parseIndirect / parseAddrWithBB）。
 */

import {
  MN1613_BBB_REGISTERS,
  MN1613_HHH_REGISTERS,
  MN1613_PPP_REGISTERS,
  MN161X_EA8_MNEMONICS,
} from "../cpu/mn1613/arch";
import type { CpuArchitecture } from "../cpu/types";
import type { AsmLineParse } from "../symbols/parseLine";
import { stripAsmComment } from "../symbols/equParse";
import { findInvalidAddressingOperands } from "./addressingModes";

/** 不正レジスタオペランドの位置 */
export interface InvalidRegisterHit {
  /** レジスタ名（大文字） */
  name: string;
  /** 行内開始列（0-based） */
  start: number;
  /** 行内終了列（排他） */
  end: number;
  /** 診断メッセージ */
  message: string;
}

/**
 * 拡張レジスタ向けの代替命令ヒントを返す。
 * @param name レジスタ名（大文字）
 * @returns ヒント文
 */
function hintForExtendedReg(name: string): string {
  if (
    /^(CSBR|SSBR|TSR0|TSR1|OSR[0-3])$/.test(name)
  ) {
    return "セグメント／OS レジスタは CPYB / SETB を使う";
  }
  if (/^(SBRB|ICB|NPP)$/.test(name)) {
    return "特殊レジスタは CPYS / SETS を使う";
  }
  if (/^(TCR|TIR|TSR|SCR|SSR|SOR|IISR|DR0)$/.test(name)) {
    return "ハード制御レジスタは CPYH / SETH を使う";
  }
  return "汎用レジスタ（R0–R4 / SP / STR）のみ使える";
}

/**
 * MN161x の 8bit EA（L/ST/B/BAL/IMS/DMS）の不正アドレッシングを列挙する。
 * 実装は `findInvalidAddressingOperands`（LD/LR 等は対象外）。
 * @param line ソース 1 行
 * @param parsed parseAsmLine の結果
 * @param arch CPU
 * @returns 不正ヒット一覧
 */
export function findInvalidEaIndexOperands(
  line: string,
  parsed: AsmLineParse,
  arch: CpuArchitecture,
): InvalidRegisterHit[] {
  if (parsed.kind !== "instruction" || !parsed.mnemonic) return [];
  if (!MN161X_EA8_MNEMONICS.has(parsed.mnemonic)) return [];
  return findInvalidAddressingOperands(line, parsed, arch);
}

/**
 * GPR 専用命令のオペランドに、GPR 以外のレジスタ名があれば列挙する。
 * @param line ソース 1 行
 * @param parsed parseAsmLine の結果
 * @param arch CPU
 * @returns 不正ヒット一覧
 */
export function findInvalidGprOperands(
  line: string,
  parsed: AsmLineParse,
  arch: CpuArchitecture,
): InvalidRegisterHit[] {
  if (parsed.kind !== "instruction" || !parsed.mnemonic) return [];
  const gprOnly = arch.gprOnlyMnemonics;
  const gprs = arch.gprRegisters;
  if (!gprOnly || !gprs || !gprOnly.has(parsed.mnemonic)) return [];

  const stripped = stripAsmComment(line);
  const mnemonicEnd = parsed.mnemonicEnd ?? 0;
  const hits: InvalidRegisterHit[] = [];
  const re = /[A-Za-z_.$][A-Za-z0-9_.$]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (m.index < mnemonicEnd) continue;
    // `0b…` / `0x…` の識別子誤検出を避ける
    if (m.index > 0 && /[A-Za-z0-9_.$]/.test(stripped.charAt(m.index - 1))) {
      continue;
    }
    const name = m[0]!.toUpperCase();
    if (!arch.registers.has(name)) continue;
    if (gprs.has(name)) continue;
    if (name === "DR0" && /^(AD|SD|M|D)$/.test(parsed.mnemonic)) continue;
    hits.push({
      name,
      start: m.index,
      end: m.index + m[0]!.length,
      message: `${name} は ${parsed.mnemonic} のオペランドに使えません（${hintForExtendedReg(name)}）`,
    });
  }
  return hits;
}

/** CPYB/SETB 系の第2オペランドに許すレジスタ族 */
type CopySetFamily = "bbb" | "ppp" | "hhh";

/** CPYB/SETB 系 1 命令の語順とレジスタ族 */
interface CopySetRule {
  /** 読み出し（CPY*）なら true。書き込み（SET*）なら false */
  copy: boolean;
  /** 特殊側のレジスタ族 */
  family: CopySetFamily;
  /** 正規のオペランド表記 */
  form: string;
}

const COPY_SET_RULES: Readonly<Record<string, CopySetRule>> = {
  CPYB: { copy: true, family: "bbb", form: "Rd, BRs" },
  SETB: { copy: false, family: "bbb", form: "Rs, BRd" },
  CPYS: { copy: true, family: "ppp", form: "Rd, SRs" },
  SETS: { copy: false, family: "ppp", form: "Rs, SRd" },
  CPYH: { copy: true, family: "hhh", form: "Rd, HRs" },
  SETH: { copy: false, family: "hhh", form: "Rs, HRd" },
};

/**
 * レジスタ族の集合を返す。
 * @param family bbb / ppp / hhh
 * @returns 大文字レジスタ名
 */
function familySet(family: CopySetFamily): ReadonlySet<string> {
  if (family === "bbb") return MN1613_BBB_REGISTERS;
  if (family === "ppp") return MN1613_PPP_REGISTERS;
  return MN1613_HHH_REGISTERS;
}

/**
 * レジスタ族の説明と、別族だったときの正しいニモニックを返す。
 * @param name レジスタ名（大文字）
 * @returns 説明。どの族でもなければ null
 */
function classifySpecialReg(name: string): {
  family: CopySetFamily;
  copyOp: string;
  setOp: string;
  label: string;
} | null {
  if (MN1613_BBB_REGISTERS.has(name)) {
    return {
      family: "bbb",
      copyOp: "CPYB",
      setOp: "SETB",
      label: "ベース／OS レジスタ（CSBR/SSBR/TSR0/TSR1/OSR0–3）",
    };
  }
  if (MN1613_PPP_REGISTERS.has(name)) {
    return {
      family: "ppp",
      copyOp: "CPYS",
      setOp: "SETS",
      label: "特殊レジスタ（SBRB/ICB/NPP）",
    };
  }
  if (MN1613_HHH_REGISTERS.has(name)) {
    return {
      family: "hhh",
      copyOp: "CPYH",
      setOp: "SETH",
      label: "ハード制御レジスタ（TCR/TIR/TSR/SCR/SSR/SOR/IISR）",
    };
  }
  return null;
}

/**
 * オペランド文字列をカンマで分割し、各部の行内開始列を付ける。
 * @param operand ニーモニック直後
 * @param base ニーモニック終了列
 * @returns 分割結果
 */
function splitCommaOperands(
  operand: string,
  base: number,
): { raw: string; start: number }[] {
  const parts: { raw: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i <= operand.length; i += 1) {
    if (i === operand.length || operand[i] === ",") {
      parts.push({ raw: operand.slice(start, i), start: base + start });
      start = i + 1;
    }
  }
  return parts;
}

/**
 * オペランド断片から最初の識別子を取る。
 * @param raw 断片
 * @param partStart 断片の行内開始列
 * @returns 識別子。無ければ null
 */
function firstIdentInOperand(
  raw: string,
  partStart: number,
): { name: string; start: number; end: number } | null {
  const m = raw.match(/[A-Za-z_.$][A-Za-z0-9_.$]*/);
  if (!m || m.index === undefined) return null;
  return {
    name: m[0]!.toUpperCase(),
    start: partStart + m.index,
    end: partStart + m.index + m[0]!.length,
  };
}

/**
 * CPYB/CPYS/CPYH / SETB/SETS/SETH のオペランド組み合わせを検証する。
 * 根拠: MN1613.mdc（Rd, BRs 等）/ retrocpu_asm encoder（BBB/PPP/HHH）。
 * @param line ソース 1 行
 * @param parsed parseAsmLine の結果
 * @param arch CPU
 * @returns 不正ヒット一覧
 */
export function findInvalidCopySetOperands(
  line: string,
  parsed: AsmLineParse,
  arch: CpuArchitecture,
): InvalidRegisterHit[] {
  if (parsed.kind !== "instruction" || !parsed.mnemonic) return [];
  if (arch.id !== "mn1613") return [];
  const rule = COPY_SET_RULES[parsed.mnemonic];
  if (!rule) return [];

  const gprs = arch.gprRegisters ?? arch.registers;
  const stripped = stripAsmComment(line);
  const mnemonicEnd = parsed.mnemonicEnd ?? 0;
  const operand = stripped.slice(mnemonicEnd);
  const parts = splitCommaOperands(operand, mnemonicEnd).filter(
    (p) => p.raw.trim().length > 0,
  );
  const hits: InvalidRegisterHit[] = [];
  const mnemStart = parsed.mnemonicStart ?? 0;
  const mnemEnd = parsed.mnemonicEnd ?? mnemStart + parsed.mnemonic.length;

  if (parts.length !== 2) {
    hits.push({
      name: parsed.mnemonic,
      start: mnemStart,
      end: mnemEnd,
      message: `${parsed.mnemonic} は ${rule.form} の 2 オペランドが必要`,
    });
    return hits;
  }

  const a0 = firstIdentInOperand(parts[0]!.raw, parts[0]!.start);
  const a1 = firstIdentInOperand(parts[1]!.raw, parts[1]!.start);
  const special = familySet(rule.family);
  const specialLabel =
    rule.family === "bbb"
      ? "ベース／OS レジスタ（CSBR/SSBR/TSR0/TSR1/OSR0–3）"
      : rule.family === "ppp"
        ? "特殊レジスタ（SBRB/ICB/NPP）"
        : "ハード制御レジスタ（TCR/TIR/TSR/SCR/SSR/SOR/IISR）";

  if (!a0) {
    hits.push({
      name: parsed.mnemonic,
      start: mnemStart,
      end: mnemEnd,
      message: `${parsed.mnemonic} の第1オペランドは汎用レジスタ（R0–R4 / SP / STR）`,
    });
    return hits;
  }
  if (!a1) {
    hits.push({
      name: parsed.mnemonic,
      start: mnemStart,
      end: mnemEnd,
      message: `${parsed.mnemonic} の第2オペランドは ${specialLabel}`,
    });
    return hits;
  }

  const cls0 = classifySpecialReg(a0.name);
  if (cls0) {
    const hint = rule.copy
      ? `書き込みは ${cls0.setOp} ${a1.name}, ${a0.name}`
      : `${parsed.mnemonic} は ${a1.name}, ${a0.name}`;
    hits.push({
      name: a0.name,
      start: a0.start,
      end: a0.end,
      message: `${a0.name} は ${parsed.mnemonic} の第1オペランドに使えません（${parsed.mnemonic} は ${rule.form}。${hint}）`,
    });
    return hits;
  }
  if (!gprs.has(a0.name)) {
    hits.push({
      name: a0.name,
      start: a0.start,
      end: a0.end,
      message: `${a0.name} は ${parsed.mnemonic} の第1オペランドに使えません（汎用レジスタ R0–R4 / SP / STR）`,
    });
    return hits;
  }

  if (!rule.copy && rule.family === "bbb" && a1.name === "CSBR") {
    hits.push({
      name: a1.name,
      start: a1.start,
      end: a1.end,
      message: "CSBR は直接書き込めない（SETB / STB 不可）",
    });
    return hits;
  }

  if (special.has(a1.name)) return hits;

  const cls1 = classifySpecialReg(a1.name);
  if (cls1) {
    const rightOp = rule.copy ? cls1.copyOp : cls1.setOp;
    hits.push({
      name: a1.name,
      start: a1.start,
      end: a1.end,
      message: `${a1.name} は ${cls1.label}なので ${parsed.mnemonic} には使えない（${rightOp} ${a0.name}, ${a1.name}）`,
    });
    return hits;
  }

  hits.push({
    name: a1.name,
    start: a1.start,
    end: a1.end,
    message: `${a1.name} は ${parsed.mnemonic} の第2オペランドに使えません（${specialLabel}）`,
  });
  return hits;
}
