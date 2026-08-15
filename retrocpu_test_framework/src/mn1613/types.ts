/**
 * MN1613 セッション／call の型
 * 根拠: asm_test_framework.mdc
 */

import type { CodeTestIoMockEntry } from "../../../retrocpu_emu/src/code_test/types.js";
import type { AsmCpuType, CpuLogMode } from "../types.js";

/** call 時に設定できるレジスタ（部分） */
export type CallRegisters = {
  R0?: number;
  R1?: number;
  R2?: number;
  R3?: number;
  R4?: number;
  SP?: number;
  STR?: number;
  CSBR?: number;
  SSBR?: number;
};

/** サブルーチン呼び出しオプション */
export type CallOptions = {
  /** レジスタ初期値（未指定の R0–R4 は 0。STR は維持） */
  registers?: CallRegisters;
  /**
   * 戻りアドレスより前に PUSH するワード列。
   * 先頭が先に PUSH（最終的にアドレスが高い側）。第4引数以降用。
   */
  stack?: number[];
  /**
   * true なら CPU レジスタを reset() する（メモリ・IO ピンは維持）。
   * 既定 false。
   */
  resetCpu?: boolean;
  /**
   * 呼び出しモード。
   * - `bal`: BAL/BALD + RET 相当（戻りアドレスのみ push）
   * - `balr`: BALR/BALL + RETL 相当（戻りアドレス + CSBR を push）
   *
   * 既定は `"bal"`。
   */
  callMode?: "bal" | "balr";
};

/** call の結果 */
export type CallResult = {
  /** run の終了状態 */
  status: string;
  /** 停止時のレジスタ */
  registers: {
    R: number[];
    SP: number;
    STR: number;
    IC: number;
    CSBR: number;
    SSBR: number;
  };
  /**
   * 引数＋戻りアドレスを PUSH した直後の SP（空きスロット）。
   * `stack: [A]`・初期 SP=`FFFF` なら `FFFD`。
   */
  preCallSp: number;
  /** 入口ワードアドレス */
  entryWordAddr: number;
};

/** スタックワーク検証 */
export type StackWorkExpect = {
  /** preCallSp からの差分（+1 でアドレス増＝戻りスタブ側） */
  from: "preCallSp";
  offset: number;
  words: number[];
};

/** MN1613 セッション生成オプション */
export type Mn1613SessionOptions = {
  /**
   * Intel HEX パス（テスト対象）。省略時は `build/session.ihx`。
   */
  hexFile?: string;
  /**
   * CDB パス（テスト対象）。省略時は `build/session.cdb`。
   */
  cdbFile?: string;
  /**
   * 各テスト前に実行する初期化ラベル（`H` まで）。既定 `g_main`。
   * `null` なら実行しない（MAIN スタブのみの部分リンクなど）。
   */
  initLabel?: string | null;
  /** CPU。表示・将来拡張用。既定 mn1613 */
  cpu?: AsmCpuType;
  /** スタック初期値（空きスロット）。既定 0xFFFF */
  stackInit?: number;
  /** 戻りスタブ（H）のワードアドレス。既定 0x17FE */
  returnStubWordAddr?: number;
  /** run 最大サイクル。既定 2_000_000（ハンドシェイク待ち込み） */
  maxCycles?: number;
  /** メモリバイト数。既定 0x80000（256K ワード＝512KB。確保時は現在時刻の種で M系列埋め） */
  memoryBytes?: number;
  /**
   * IO モック（emulater_code_test.mdc §7）。
   * 1 件以上なら create / reload で RD/WT をキックする。
   */
  ioMock?: CodeTestIoMockEntry[];
  /**
   * テスト専用 CPU ログの出力パス。未指定なら出力しない。
   * `${FRAMEWORK_BUILD}` などのプレースホルダは設定解決側で展開する。
   */
  cpuLogFile?: string;
  /**
   * CPU ログの本文モード。`cpuLogFile` 指定時のみ有効。
   * 省略時はタイトルの START / END のみ。
   */
  cpuLogMode?: CpuLogMode;
};
