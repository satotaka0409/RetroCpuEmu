/**
 * TMS9995 成果物セッション（HEX/CDB ロード・シンボル／メモリ検証）。
 * CPU 実行は未対応（retrocpu_emu に TMS9995 コアが無い）。
 * 根拠: asm_test_framework.mdc / TMS9995_CPUボードメモリ_IOマップ.mdc
 */

import fs from "node:fs";
import { loadIntelHex } from "../../../retrocpu_emu/src/code_test/intel_hex.js";
import type { CdbTable } from "../../../retrocpu_emu/src/code_test/cdb.js";
import type { CdbSymbol } from "../../../retrocpu_emu/src/code_test/types.js";
import { parseTms9995Cdb, requireTms9995Symbol } from "./cdb.js";
import {
  planTms9995Call,
  TMS9995_DEFAULT_ARG_REGISTERS,
  TMS9995_DEFAULT_STACK_INIT,
  TMS9995_DEFAULT_WORKSPACE,
  TMS9995_MONITOR_ARG_REGISTERS,
} from "./calling_convention.js";
import type { Tms9995CallPlan, Tms9995CallPlanOptions } from "./types.js";
import { Tms9995CruHandshakeMock } from "./cru_handshake.js";

/** モニター相当の 64KB 平アドレス空間（当面） */
const DEFAULT_MEMORY_BYTES = 0x10000;

export type Tms9995SessionOptions = {
  hexFile: string;
  cdbFile: string;
  /** メモリバイト数。省略時 64KB */
  memoryBytes?: number;
  /** true なら CRU ハンドシェイクモックを attach */
  attachCruHandshake?: boolean;
};

/**
 * TMS9995 の静的セッション。
 * `call` / `runInit` は投げて明示する（実行コア待ち）。
 */
export class Tms9995ArtifactSession {
  private memory: Uint8Array;
  private cdb: CdbTable;
  private readonly hexFile: string;
  private readonly cdbFile: string;
  private readonly memoryBytes: number;
  readonly cru: Tms9995CruHandshakeMock | null;

  /**
   * @param options HEX/CDB パスとオプション
   */
  constructor(options: Tms9995SessionOptions) {
    this.hexFile = options.hexFile;
    this.cdbFile = options.cdbFile;
    this.memoryBytes = options.memoryBytes ?? DEFAULT_MEMORY_BYTES;
    this.memory = new Uint8Array(this.memoryBytes);
    this.cdb = parseTms9995Cdb("");
    this.cru =
      options.attachCruHandshake === false
        ? null
        : new Tms9995CruHandshakeMock();
    this.reload();
  }

  /** HEX を再ロードし、CRU モックをリセットする。 */
  reload(): void {
    const hexText = fs.readFileSync(this.hexFile, "utf8");
    const cdbText = fs.readFileSync(this.cdbFile, "utf8");
    this.memory = new Uint8Array(this.memoryBytes);
    loadIntelHex(hexText, this.memory);
    this.cdb = parseTms9995Cdb(cdbText);
    this.cru?.reset();
  }

  /**
   * 公開ラベルのバイトアドレス。
   * @param name `.global` 名
   * @returns バイトアドレス
   */
  requireByteAddr(name: string): number {
    return requireTms9995Symbol(this.cdb, name).byteAddr;
  }

  /**
   * 公開ラベルのシンボル。
   * @param name `.global` 名
   * @returns CDB シンボル
   */
  requireSymbol(name: string): CdbSymbol {
    return requireTms9995Symbol(this.cdb, name);
  }

  /** CDB 表（読み取り専用用途）。 */
  getCdb(): CdbTable {
    return this.cdb;
  }

  /**
   * メモリの 1 バイトを読む。
   * @param byteAddr バイトアドレス
   * @returns 0..255
   */
  readByte(byteAddr: number): number {
    const a = byteAddr >>> 0;
    if (a >= this.memoryBytes) {
      throw new Error(`readByte out of range: 0x${a.toString(16)}`);
    }
    return this.memory[a]!;
  }

  /**
   * ビッグエンディアン 16bit を読む。
   * @param byteAddr 偶数バイトアドレス
   * @returns ワード値
   */
  readWordBe(byteAddr: number): number {
    const a = byteAddr >>> 0;
    if (a & 1) {
      throw new Error(`readWordBe requires even address (got 0x${a.toString(16)})`);
    }
    if (a + 1 >= this.memoryBytes) {
      throw new Error(`readWordBe out of range: 0x${a.toString(16)}`);
    }
    return (this.memory[a]! << 8) | this.memory[a + 1]!;
  }

  /**
   * 連続ワードを BE で読む。
   * @param byteAddr 開始（偶数）
   * @param count 語数
   * @returns ワード配列
   */
  readWordsBe(byteAddr: number, count: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(this.readWordBe(byteAddr + i * 2));
    }
    return out;
  }

  /**
   * BIOS ジャンプ表スロット（`B label` = 4 バイト）の分岐先を読む。
   * TMS9995 の `B` は絶対アドレス語が後続する想定で、スロット先頭+2 の語を返す。
   * @param tableByteAddr ジャンプ表エントリ先頭（例 0x0110）
   * @returns 分岐先バイトアドレス（命令語が B 系でない場合も生値）
   */
  readBiosJumpTarget(tableByteAddr: number): number {
    return this.readWordBe(tableByteAddr + 2);
  }

  /**
   * 呼び出し規約プラン（実行はしない。テスト準備用）。
   * モニター BIOS は当面 R1/R2/R3（`TMS9995_MONITOR_ARG_REGISTERS`）。
   * @param options 引数とスタック。省略時はモニター ABI・既定 SP/WP
   * @returns 配置プラン
   */
  planCall(
    options: Omit<Tms9995CallPlanOptions, "argRegisters" | "stackInit"> & {
      argRegisters?: readonly number[];
      stackInit?: number;
      /** true なら asm_rules の R2..R9。省略時はモニター ABI（R1..） */
      useAsmRulesArgs?: boolean;
    },
  ): Tms9995CallPlan {
    const useAsm = options.useAsmRulesArgs === true;
    const argRegisters =
      options.argRegisters ??
      (useAsm
        ? [...TMS9995_DEFAULT_ARG_REGISTERS]
        : [...TMS9995_MONITOR_ARG_REGISTERS]);
    return planTms9995Call({
      args: options.args,
      returnAddr: options.returnAddr,
      stackInit: options.stackInit ?? TMS9995_DEFAULT_STACK_INIT,
      argRegisters,
      allowSpecialPurposeRegisters:
        options.allowSpecialPurposeRegisters ?? !useAsm,
    });
  }

  /** 既定ワークスペース（WP）バイトアドレス。 */
  defaultWorkspace(): number {
    return TMS9995_DEFAULT_WORKSPACE;
  }

  /** 既定ソフトウェア SP（R10）初期値。 */
  defaultStackInit(): number {
    return TMS9995_DEFAULT_STACK_INIT;
  }

  /**
   * 実行は未実装。
   * @throws 常に
   */
  runInit(): never {
    throw new Error(
      "Tms9995ArtifactSession.runInit is unavailable: TMS9995 CPU emu is not implemented yet",
    );
  }

  /**
   * 実行は未実装。
   * @throws 常に
   */
  call(_label: string): never {
    throw new Error(
      "Tms9995ArtifactSession.call is unavailable: TMS9995 CPU emu is not implemented yet",
    );
  }
}

/**
 * HEX/CDB から成果物セッションを作る。
 * @param options パスとオプション
 * @returns ロード済みセッション
 */
export function createTms9995ArtifactSession(
  options: Tms9995SessionOptions,
): Tms9995ArtifactSession {
  return new Tms9995ArtifactSession(options);
}
