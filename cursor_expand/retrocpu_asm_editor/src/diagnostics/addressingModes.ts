/**
 * MN1613 アドレッシングモードの診断。
 * 根拠: MN1613.mdc / retrocpu_asm parseEA・parseIndirect・parseAddrWithBB。
 */

import {
  MN1613_BB_REGISTERS,
  MN161X_EA8_MNEMONICS,
} from "../cpu/mn1613/arch";
import type { CpuArchitecture } from "../cpu/types";
import type { AsmLineParse } from "../symbols/parseLine";
import { stripAsmComment } from "../symbols/equParse";
import type { InvalidRegisterHit } from "./invalidRegisters";

/** インデックス（L/ST の D(Xn)） */
const INDEX_REGS = new Set(["X0", "X1"]);

/** レジスタ間接の Ri（R0 / SP 不可。X0/X1 表記もアセンブラは非受理） */
const RI_REGS = new Set(["R1", "R2", "R3", "R4"]);

/** GPR 名 */
const GPR = new Set(["R0", "R1", "R2", "R3", "R4", "SP", "STR", "X0", "X1"]);

/** スキップ条件（オペランド末尾） */
const SKIP_TOKENS = new Set([
  "SKP",
  "M",
  "PZ",
  "Z",
  "E",
  "NZ",
  "NE",
  "MZ",
  "P",
  "EZ",
  "ENZ",
  "OZ",
  "ONZ",
  "LMZ",
  "LP",
  "LPZ",
  "LM",
]);

/** LD / STD */
const LDSTD = new Set(["LD", "STD"]);

/** LR / STR（ニモニック。STR レジスタとは文脈で区別） */
const LRSTR = new Set(["LR", "STR"]);

/** (Ri) をメモリオペランドに取る MN1613 命令 */
const RI_MNEMONICS = new Set([
  "MVWR",
  "MVBR",
  "BSWR",
  "DSWR",
  "AWR",
  "SWR",
  "CWR",
  "CBR",
  "ANDR",
  "ORR",
  "EORR",
  "LADR",
  "DAA",
  "DAS",
  "FA",
  "FS",
  "FM",
  "FD",
  "RDR",
  "WTR",
]);

/** AD/SD/M/D は DR0, (R1)–(R4)（メモリ間接。FA 等と同じ） */
const DR0_RI = new Set(["AD", "SD", "M", "D"]);

/** BR / BALR は (Ri) のみ */
const BR_RI = new Set(["BR", "BALR"]);

/**
 * カンマ分割（括弧内のカンマは分割しない）。
 * @param operand ニーモニック直後
 * @param base 行内開始列
 * @returns 各オペランド
 */
function splitOperands(
  operand: string,
  base: number,
): { text: string; absStart: number }[] {
  const parts: { text: string; absStart: number }[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i <= operand.length; i += 1) {
    const c = i < operand.length ? operand[i] : ",";
    if (c === "(" || c === "[") depth += 1;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (i === operand.length || (c === "," && depth === 0)) {
      parts.push({
        text: operand.slice(start, i),
        absStart: base + start,
      });
      start = i + 1;
    }
  }
  return parts.filter((p) => p.text.trim().length > 0);
}

/**
 * 末尾の Skip / C を除く。
 * @param parts オペランド列
 * @returns 残ったオペランド
 */
function stripSkipCarry(
  parts: { text: string; absStart: number }[],
): { text: string; absStart: number }[] {
  const out = [...parts];
  while (out.length > 0) {
    const t = out[out.length - 1]!.text.trim().toUpperCase();
    if (SKIP_TOKENS.has(t) || t === "C") {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

/** 1 オペランドの分類 */
type EaKind =
  | "zp"
  | "zpind"
  | "relind"
  | "idx"
  | "idxind"
  | "ri"
  | "bbidx"
  | "reg"
  | "other";

interface EaShape {
  kind: EaKind;
  /** インデックス / Ri / BRn / レジスタ名 */
  name?: string;
}

/**
 * 1 オペランドのアドレッシング形状を分類する。
 * @param raw オペランド（前後空白可）
 * @returns 形状
 */
function classifyEa(raw: string): EaShape {
  const t = raw.trim();
  let m: RegExpMatchArray | null;

  m = t.match(/^\(\s*\*.*\)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) return { kind: "idxind", name: m[1]!.toUpperCase() };

  m = t.match(/^\[\s*\*.*\]\s*,\s*([A-Za-z_][A-Za-z0-9_]*)$/i);
  if (m) return { kind: "idxind", name: m[1]!.toUpperCase() };

  // `#len(label)` は即値式。`disp(Xn)` のインデックスと誤認しない
  if (/^#?\s*len\s*\(/i.test(t)) return { kind: "other" };

  m = t.match(/^(.+)\(\s*(CSBR|SSBR|TSR0|TSR1)\s*\)$/i);
  if (m) return { kind: "bbidx", name: m[2]!.toUpperCase() };

  m = t.match(/^(.+)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    const idx = m[2]!.toUpperCase();
    if (INDEX_REGS.has(idx)) return { kind: "idx", name: idx };
    if (MN1613_BB_REGISTERS.has(idx)) return { kind: "bbidx", name: idx };
    return { kind: "idx", name: idx };
  }

  m = t.match(/^-\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) return { kind: "ri", name: m[1]!.toUpperCase() };
  m = t.match(/^\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)\+$/i);
  if (m) return { kind: "ri", name: m[1]!.toUpperCase() };
  m = t.match(/^@?\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)$/i);
  if (m) {
    const inner = m[1]!.toUpperCase();
    if (GPR.has(inner) || MN1613_BB_REGISTERS.has(inner)) {
      return { kind: "ri", name: inner };
    }
    return { kind: "relind", name: inner };
  }
  m = t.match(/^\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]$/i);
  if (m) {
    const inner = m[1]!.toUpperCase();
    if (GPR.has(inner)) return { kind: "ri", name: inner };
    return { kind: "relind", name: inner };
  }

  if (/^\(\s*\*/.test(t) || /^\[\s*\*/.test(t)) return { kind: "zpind" };
  if (t.startsWith("*")) return { kind: "zp" };

  const ident = t.match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
  if (ident) {
    const name = ident[1]!.toUpperCase();
    if (GPR.has(name) || MN1613_BB_REGISTERS.has(name)) {
      return { kind: "reg", name };
    }
  }
  return { kind: "other" };
}

/**
 * トークン内の名前位置でヒットを作る。
 * @param token オペランド
 * @param name 強調する名前
 * @param message 診断
 * @returns ヒット
 */
function hitAt(
  token: { text: string; absStart: number },
  name: string,
  message: string,
): InvalidRegisterHit {
  const upper = name.toUpperCase();
  const idx = token.text.toUpperCase().lastIndexOf(upper);
  const lead = token.text.match(/^\s*/)?.[0].length ?? 0;
  const start = idx >= 0 ? token.absStart + idx : token.absStart + lead;
  return {
    name: upper,
    start,
    end: start + upper.length,
    message,
  };
}

/**
 * 不正インデックスのヒント。
 * @param name レジスタ
 * @returns ヒント
 */
function hintIndex(name: string): string {
  if (name === "SP") {
    return "SP 相対アドレッシングは無い。インデックスは X0 / X1 のみ";
  }
  if (name === "R3") return "R3 は X0 と書く";
  if (name === "R4") return "R4 は X1 と書く";
  if (MN1613_BB_REGISTERS.has(name)) {
    return `16bit+${name} は LD/STD（例: LD R0, addr(${name})）`;
  }
  if (/^OSR[0-3]$/.test(name)) {
    return "OSR は LD/STD の BRn に使えない（CSBR/SSBR/TSR0/TSR1）";
  }
  return "インデックスは X0 / X1 のみ（R3=X0、R4=X1）";
}

/**
 * 不正な (Ri) のヒント。
 * @param name レジスタ
 * @returns ヒント
 */
function hintRi(name: string): string {
  if (name === "X0") return "間接は (R3) と書く（X0 は L/ST のインデックス）";
  if (name === "X1") return "間接は (R4) と書く（X1 は L/ST のインデックス）";
  if (name === "R0") return "レジスタ間接に R0 は使えない（R1–R4）";
  if (name === "SP") return "レジスタ間接に SP は使えない（R1–R4）";
  return "レジスタ間接は (R1)–(R4) のみ";
}

/**
 * EA8 命令のアドレス部を検証する。
 * @param mnemonic L/ST/B/BAL/IMS/DMS
 * @param addrTok アドレスオペランド
 * @param hits 結果
 */
function checkEa8(
  mnemonic: string,
  addrTok: { text: string; absStart: number },
  hits: InvalidRegisterHit[],
): void {
  const ea = classifyEa(addrTok.text);
  if (ea.kind === "idx" || ea.kind === "idxind") {
    const n = ea.name ?? "";
    if (INDEX_REGS.has(n)) return;
    hits.push(
      hitAt(
        addrTok,
        n || mnemonic,
        `${n} は ${mnemonic} のインデックスに使えません（${hintIndex(n)}）`,
      ),
    );
    return;
  }
  if (ea.kind === "bbidx") {
    const n = ea.name ?? "";
    const alt = mnemonic === "ST" || mnemonic === "DMS" ? "STD" : "LD";
    hits.push(
      hitAt(
        addrTok,
        n,
        `${mnemonic} に ${n} ベースは使えない。${alt} R0, addr(${n}) を使う`,
      ),
    );
    return;
  }
  if (ea.kind === "ri") {
    const n = ea.name ?? "";
    let alt = "LR / STR";
    if (mnemonic === "L") alt = `LR R0, (${RI_REGS.has(n) ? n : "R2"})`;
    else if (mnemonic === "ST") alt = `STR R0, (${RI_REGS.has(n) ? n : "R2"})`;
    else if (mnemonic === "B") alt = `BR (${RI_REGS.has(n) ? n : "R2"})`;
    else if (mnemonic === "BAL") alt = `BALR (${RI_REGS.has(n) ? n : "R3"})`;
    hits.push(
      hitAt(
        addrTok,
        n,
        `${mnemonic} にレジスタ間接は無い（${alt}）`,
      ),
    );
    return;
  }
  if (ea.kind === "reg" && (mnemonic === "L" || mnemonic === "ST")) {
    const n = ea.name ?? "";
    hits.push(
      hitAt(
        addrTok,
        n,
        `${mnemonic} の第2オペランドは Addr（*D / ラベル / D(X0) 等）。レジスタ間は MV`,
      ),
    );
  }
}

/**
 * LD/STD のアドレス部を検証する。
 * @param mnemonic LD/STD
 * @param addrToks 第2オペランド以降
 * @param hits 結果
 */
function checkLdStd(
  mnemonic: string,
  addrToks: { text: string; absStart: number }[],
  hits: InvalidRegisterHit[],
): void {
  if (addrToks.length === 2) {
    const bb = addrToks[0]!.text.trim().toUpperCase();
    if (!MN1613_BB_REGISTERS.has(bb)) {
      hits.push(
        hitAt(
          addrToks[0]!,
          bb,
          `${mnemonic} の BRn は CSBR/SSBR/TSR0/TSR1`,
        ),
      );
    }
    return;
  }
  if (addrToks.length !== 1) return;
  const tok = addrToks[0]!;
  const ea = classifyEa(tok.text);
  if (ea.kind === "idx" || ea.kind === "idxind") {
    const n = ea.name ?? "";
    if (/^OSR[0-3]$/.test(n)) {
      hits.push(
        hitAt(
          tok,
          n,
          `${mnemonic} の BRn は CSBR/SSBR/TSR0/TSR1（${n} は不可）`,
        ),
      );
      return;
    }
    const alt = mnemonic === "STD" ? "ST" : "L";
    hits.push(
      hitAt(
        tok,
        n,
        `${mnemonic} は 16bit 直接。8bit インデックスは ${alt} R0, disp(${INDEX_REGS.has(n) ? n : "X0"})`,
      ),
    );
    return;
  }
  if (ea.kind === "ri") {
    const n = ea.name ?? "";
    const alt = mnemonic === "STD" ? "STR" : "LR";
    hits.push(
      hitAt(tok, n, `${mnemonic} にレジスタ間接は無い（${alt} R0, (R2)）`),
    );
    return;
  }
  if (ea.kind === "zp" || ea.kind === "zpind") {
    const alt = mnemonic === "STD" ? "ST" : "L";
    hits.push(
      hitAt(tok, mnemonic, `${mnemonic} にゼロページ *D は無い（${alt} を使う）`),
    );
  }
}

/**
 * (Ri) オペランドを検証する。
 * @param mnemonic 命令
 * @param tok (Ri) のはずのオペランド
 * @param hits 結果
 */
function checkRi(
  mnemonic: string,
  tok: { text: string; absStart: number },
  hits: InvalidRegisterHit[],
): void {
  const ea = classifyEa(tok.text);
  if (ea.kind === "ri" && ea.name && RI_REGS.has(ea.name)) return;
  if (ea.kind === "idx" || ea.kind === "idxind" || ea.kind === "bbidx") {
    const n = ea.name ?? mnemonic;
    hits.push(
      hitAt(
        tok,
        n,
        `${mnemonic} はレジスタ間接 (R1)–(R4)。8bit EA は L/ST、16bit は LD/STD`,
      ),
    );
    return;
  }
  if (ea.kind === "ri" && ea.name) {
    hits.push(hitAt(tok, ea.name, `${mnemonic}: ${hintRi(ea.name)}`));
    return;
  }
  if (ea.kind === "reg" && ea.name) {
    hits.push(
      hitAt(tok, ea.name, `${mnemonic} は (${ea.name}) の形（R1–R4）`),
    );
    return;
  }
  const inner = tok.text.match(/[A-Za-z_][A-Za-z0-9_]*/);
  const name = inner?.[0] ?? mnemonic;
  hits.push(
    hitAt(tok, name, `${mnemonic} のメモリオペランドは (R1)–(R4) / (Ri)+ / -(Ri)`),
  );
}

/**
 * MN1613 のアドレッシングが命令と食い違っていれば列挙する。
 * @param line ソース 1 行
 * @param parsed parseAsmLine の結果
 * @param arch CPU
 * @returns 不正ヒット
 */
export function findInvalidAddressingOperands(
  line: string,
  parsed: AsmLineParse,
  arch: CpuArchitecture,
): InvalidRegisterHit[] {
  if (parsed.kind !== "instruction" || !parsed.mnemonic) return [];
  if (arch.id !== "mn1613") return [];

  const mnemonic = parsed.mnemonic;
  const stripped = stripAsmComment(line);
  const mnemonicEnd = parsed.mnemonicEnd ?? 0;
  const operand = stripped.slice(mnemonicEnd);
  const parts = splitOperands(operand, mnemonicEnd);
  const hits: InvalidRegisterHit[] = [];

  if (MN161X_EA8_MNEMONICS.has(mnemonic)) {
    if (mnemonic === "L" || mnemonic === "ST") {
      if (parts.length >= 2) {
        const last = parts[parts.length - 1]!;
        const lastName = last.text.trim().toUpperCase();
        if (parts.length >= 3 && (INDEX_REGS.has(lastName) || GPR.has(lastName))) {
          if (!INDEX_REGS.has(lastName)) {
            hits.push(
              hitAt(
                last,
                lastName,
                `${lastName} は ${mnemonic} のインデックスに使えません（${hintIndex(lastName)}）`,
              ),
            );
          }
          return hits;
        }
        checkEa8(mnemonic, parts[1]!, hits);
      }
      return hits;
    }
    if (parts.length >= 1) {
      const last = parts[parts.length - 1]!;
      const lastName = last.text.trim().toUpperCase();
      if (parts.length >= 2 && (INDEX_REGS.has(lastName) || GPR.has(lastName))) {
        if (!INDEX_REGS.has(lastName)) {
          hits.push(
            hitAt(
              last,
              lastName,
              `${lastName} は ${mnemonic} のインデックスに使えません（${hintIndex(lastName)}）`,
            ),
          );
        }
        return hits;
      }
      checkEa8(mnemonic, parts[0]!, hits);
    }
    return hits;
  }

  if (arch.id !== "mn1613") return hits;

  if (LDSTD.has(mnemonic)) {
    if (parts.length >= 2) checkLdStd(mnemonic, parts.slice(1), hits);
    return hits;
  }

  if (LRSTR.has(mnemonic)) {
    const rest = parts.slice(1);
    if (rest.length === 0) return hits;
    if (rest.length >= 2) {
      const bb = rest[0]!.text.trim().toUpperCase();
      if (MN1613_BB_REGISTERS.has(bb) || GPR.has(bb)) {
        if (!MN1613_BB_REGISTERS.has(bb)) {
          hits.push(
            hitAt(rest[0]!, bb, `${mnemonic} の BRn は CSBR/SSBR/TSR0/TSR1`),
          );
        }
        checkRi(mnemonic, rest[rest.length - 1]!, hits);
        return hits;
      }
    }
    checkRi(mnemonic, rest[rest.length - 1]!, hits);
    return hits;
  }

  if (BR_RI.has(mnemonic)) {
    if (parts.length >= 1) {
      const tok = parts[0]!;
      const ea = classifyEa(tok.text);
      if (ea.kind === "other" || ea.kind === "zp" || ea.kind === "relind") {
        hits.push(
          hitAt(
            tok,
            mnemonic,
            `${mnemonic} は (R1)–(R4)。ラベルへは ${mnemonic === "BALR" ? "BAL / BALD" : "B / BD"}`,
          ),
        );
        return hits;
      }
      checkRi(mnemonic, tok, hits);
    }
    return hits;
  }

  if (DR0_RI.has(mnemonic)) {
    const rest = stripSkipCarry(parts);
    if (rest.length >= 1) {
      const a0 = rest[0]!.text.trim().toUpperCase();
      if (a0 !== "DR0") {
        hits.push(
          hitAt(rest[0]!, a0, `${mnemonic} の第1オペランドは DR0`),
        );
      }
    }
    if (rest.length >= 2) checkRi(mnemonic, rest[1]!, hits);
    return hits;
  }

  if (RI_MNEMONICS.has(mnemonic)) {
    const rest = stripSkipCarry(parts);
    if (rest.length >= 2) checkRi(mnemonic, rest[rest.length - 1]!, hits);
    return hits;
  }

  return hits;
}
