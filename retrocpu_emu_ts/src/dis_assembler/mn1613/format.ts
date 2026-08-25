/**
 * デコード済み MN1613 命令を asm-rules 書式の文字列にする
 * 根拠: asm-rules.mdc / MN1613.mdc
 */

import type { AddrForm, DecodedInst, DecodedOp } from "./decode";
import type { Mn1613LabelTable } from "./labels";

const SKIP_NAME = [
  "",
  "SKP",
  "M",
  "PZ",
  "Z",
  "NZ",
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
] as const;

const EE_NAME = ["", "RE", "SE", "CE"] as const;

/**
 * 16bit 値を `0xHHHH` にする。
 * @param v 値
 * @returns 4 桁 hex
 */
export function hex16(v: number): string {
  return `0x${(v & 0xffff).toString(16).padStart(4, "0")}`;
}

/**
 * 8bit 値を `0xHH` にする。
 * @param v 値
 * @returns 2 桁 hex
 */
export function hex8(v: number): string {
  return `0x${(v & 0xff).toString(16).padStart(2, "0")}`;
}

/**
 * アドレスをラベルがあれば名前、なければ hex にする。
 * @param wordAddr ワードアドレス
 * @param labels ラベル表
 * @param width 8=ゼロページ／IO、16=セグメント内
 * @returns 表示文字列
 */
function addrText(
  wordAddr: number,
  labels: Mn1613LabelTable | undefined,
  width: 8 | 16,
): string {
  const name = labels?.lookup(wordAddr & 0xffff);
  if (name) return name;
  return width === 8 ? hex8(wordAddr) : hex16(wordAddr);
}

/**
 * 即値を `#…` にする。16bit がラベルと一致すれば `#LABEL`。
 * @param v 値
 * @param bits ビット幅
 * @param labels ラベル表
 * @returns 即値文字列
 */
function immText(
  v: number,
  bits: 4 | 8 | 16,
  labels: Mn1613LabelTable | undefined,
): string {
  if (bits === 16) {
    const name = labels?.lookup(v & 0xffff);
    if (name) return `#${name}`;
    return `#${hex16(v)}`;
  }
  if (bits === 8) return `#${hex8(v)}`;
  return `#${v & 0xf}`;
}

/**
 * アドレス系オペランドを書式化する。
 * @param v アドレスまたはゼロページ／IO 番号
 * @param form 表示形
 * @param bb ベースレジスタ名（form=bb）
 * @param labels ラベル表
 * @returns 文字列
 */
function formatAddr(
  v: number,
  form: AddrForm,
  bb: string | undefined,
  labels: Mn1613LabelTable | undefined,
): string {
  switch (form) {
    case "plain":
      return addrText(v, labels, 16);
    case "zp":
      return `*${addrText(v, labels, 8)}`;
    case "paren":
      return `(${addrText(v, labels, 16)})`;
    case "at":
      return `@${addrText(v, labels, 16)}`;
    case "star_paren":
      return `(*${addrText(v, labels, 8)})`;
    case "io":
      return addrText(v, labels, 8);
    case "bb":
      return `${addrText(v, labels, 16)}(${bb ?? "CSBR"})`;
  }
}

/**
 * 1 オペランドを文字列にする。
 * @param op オペランド
 * @param labels ラベル表
 * @returns トークン。省略なら null
 */
function formatOp(
  op: DecodedOp,
  labels: Mn1613LabelTable | undefined,
): string | null {
  switch (op.k) {
    case "raw":
      return op.s;
    case "imm":
      return immText(op.v, op.bits, labels);
    case "skip": {
      const n = SKIP_NAME[op.n & 0xf] ?? "";
      return n || null;
    }
    case "ee": {
      const n = EE_NAME[op.n & 3] ?? "";
      return n || null;
    }
    case "c":
      return "C";
    case "addr":
      return formatAddr(op.v, op.form, op.bb, labels);
  }
}

/**
 * デコード結果を 1 行のアセンブリにする。
 * @param inst デコード結果
 * @param labels ラベル表（省略可）
 * @returns `MNEM arg, arg, …`
 */
export function formatDecoded(
  inst: DecodedInst,
  labels?: Mn1613LabelTable,
): string {
  if (inst.mnemonic === ".word") {
    const imm = inst.ops[0];
    if (imm?.k === "imm") return `.word ${hex16(imm.v)}`;
  }
  const args: string[] = [];
  for (const op of inst.ops) {
    const s = formatOp(op, labels);
    if (s) args.push(s);
  }
  if (args.length === 0) return inst.mnemonic;
  return `${inst.mnemonic} ${args.join(", ")}`;
}
