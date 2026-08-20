import type {
  Tms9995ArgLocation,
  Tms9995CallDiagnostics,
  Tms9995CallPlan,
  Tms9995CallPlanOptions,
  Tms9995RegisterFile,
  Tms9995StackWord,
} from "./types.js";

/** asm_rules.mdc の既定: 引数は R2..R9。 */
export const TMS9995_DEFAULT_ARG_REGISTERS = [2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * 現行 `retrocpu_boot_monitor` TMS BIOS の引数（第1=R1）。
 * asm_rules の R2 起点へ揃えるまでの暫定 ABI。
 */
export const TMS9995_MONITOR_ARG_REGISTERS = [1, 2, 3] as const;

/**
 * 既定で引数に使わないレジスタ。
 * - R0/R1: 乗除算主用途（モニター ABI は R1 を第1引数に使う例外あり）
 * - R10: ソフトウェア SP
 * - R11: BL 復帰アドレス
 * - R12: CRU ベース
 * - R13..R15: BLWP 退避領域
 */
export const TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS = [
  0, 1, 10, 11, 12, 13, 14, 15,
] as const;

/** モニター memmap.inc のスタック初期値（R10）。 */
export const TMS9995_DEFAULT_STACK_INIT = 0xfe00;

/** モニター memmap.inc のワークスペース（WP）。 */
export const TMS9995_DEFAULT_WORKSPACE = 0xff00;

function u16(value: number): number {
  return value & 0xffff;
}

function makeRegisterFile(): Tms9995RegisterFile {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function uniqueSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

/**
 * 引数レジスタ配列を規約に照らして検証する。
 * @param argRegisters 候補
 * @param forbidden 禁止レジスタ集合
 * @returns 検証結果
 */
export function validateTms9995ArgRegisters(
  argRegisters: readonly number[],
  forbidden: readonly number[] = TMS9995_DEFAULT_FORBIDDEN_ARG_REGISTERS,
): Tms9995CallDiagnostics {
  const outOfRangeArgRegisters: number[] = [];
  const forbiddenArgRegisters: number[] = [];
  const seen = new Set<number>();
  const duplicatedArgRegisters: number[] = [];
  const forbiddenSet = new Set<number>(forbidden);

  for (const reg of argRegisters) {
    if (!Number.isInteger(reg) || reg < 0 || reg > 15) {
      outOfRangeArgRegisters.push(reg);
      continue;
    }
    if (forbiddenSet.has(reg)) {
      forbiddenArgRegisters.push(reg);
    }
    if (seen.has(reg)) {
      duplicatedArgRegisters.push(reg);
    }
    seen.add(reg);
  }

  return {
    forbiddenArgRegisters: uniqueSorted(forbiddenArgRegisters),
    duplicatedArgRegisters: uniqueSorted(duplicatedArgRegisters),
    outOfRangeArgRegisters: uniqueSorted(outOfRangeArgRegisters),
  };
}

/**
 * TMS9995 呼び出し規約に従って引数配置を計画する。
 * 余剰引数は後ろから順に push し、スタックは下位アドレスへ伸ばす。
 * @param options 呼び出しオプション
 * @returns 引数配置プラン
 */
export function planTms9995Call(
  options: Tms9995CallPlanOptions,
): Tms9995CallPlan {
  const argRegisters =
    options.argRegisters === undefined
      ? [...TMS9995_DEFAULT_ARG_REGISTERS]
      : [...options.argRegisters];
  const diagnostics = validateTms9995ArgRegisters(argRegisters);
  if (diagnostics.outOfRangeArgRegisters.length > 0) {
    throw new Error(
      `argRegisters out of range: ${diagnostics.outOfRangeArgRegisters.join(", ")}`,
    );
  }
  if (diagnostics.duplicatedArgRegisters.length > 0) {
    throw new Error(
      `argRegisters duplicated: ${diagnostics.duplicatedArgRegisters.join(", ")}`,
    );
  }
  if (
    !options.allowSpecialPurposeRegisters &&
    diagnostics.forbiddenArgRegisters.length > 0
  ) {
    throw new Error(
      `argRegisters use forbidden registers: ${diagnostics.forbiddenArgRegisters.join(
        ", ",
      )}`,
    );
  }

  const args = options.args.map((v) => u16(v));
  const regFile = makeRegisterFile();
  const spBeforePush = u16(options.stackInit ?? TMS9995_DEFAULT_STACK_INIT);
  if (spBeforePush & 1) {
    throw new Error(
      `stackInit must be even byte address (got 0x${spBeforePush.toString(16)})`,
    );
  }

  const regArgCount = Math.min(argRegisters.length, args.length);
  const argLocations: Tms9995ArgLocation[] = [];
  for (let i = 0; i < regArgCount; i += 1) {
    const reg = argRegisters[i]!;
    const value = args[i]!;
    regFile[reg] = value;
    argLocations.push({ kind: "register", argIndex: i, reg, value });
  }

  let sp = spBeforePush;
  const stackWords: Tms9995StackWord[] = [];
  for (let i = args.length - 1; i >= regArgCount; i -= 1) {
    sp = u16(sp - 2);
    const value = args[i]!;
    stackWords.push({ byteAddr: sp, value, argIndex: i });
    argLocations.push({ kind: "stack", argIndex: i, byteAddr: sp, value });
  }

  regFile[10] = sp;
  regFile[11] = u16(options.returnAddr ?? 0);

  argLocations.sort((a, b) => a.argIndex - b.argIndex);

  return {
    registers: regFile,
    spBeforePush,
    spAfterPush: sp,
    stackWords,
    argLocations,
  };
}
