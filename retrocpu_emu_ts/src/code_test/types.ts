/**
 * コードテスト・ミドルウェア共通型
 * 根拠: .cursor/rules/emulater_code_test.mdc
 */

import type { CPURegister } from "../cpuboard/mn1613/mn1613";
import type { IoTimerScheduler } from "../ioboard/timer/io_timer";

/** 呼び出し時に設定できるレジスタ（部分） */
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
  TSR0?: number;
  TSR1?: number;
};

export type CallOptions = {
  /** レジスタ初期値（部分指定） */
  registers?: CallRegisters;
  /**
   * 戻りアドレスより前に PUSH するワード列。
   * 先頭要素が先に PUSH される（最終的にアドレスが高い側）。
   */
  stack?: number[];
  /**
   * 呼び出しモード。
   * - `bal`: BAL/BALD + RET 相当（戻りアドレスのみ push）
   * - `balr`: BALR/BALL + RETL 相当（戻りアドレス + CSBR を push）
   *
   * 既定は `"bal"`。
   */
  callMode?: "bal" | "balr";
};

export type CallResult = {
  status: string;
  registers: CPURegister;
  /** call 直前の SP（スタックワーク検証の基準） */
  preCallSp: number;
  /** 呼び出した入口（ワードアドレス） */
  entryWordAddr: number;
};

export type Mn1613CodeTestOptions = {
  /** スタック初期値（空きスロットを指す）。既定 0xFFFF */
  stackInit?: number;
  /** 戻りスタブ（H）を置くワードアドレス。既定 0x17FE */
  returnStubWordAddr?: number;
  /** run の最大サイクル。既定 100000 */
  maxCycles?: number;
  /** メモリバイト数。既定 512KB（256K ワード） */
  memoryBytes?: number;
  /**
   * 設定があれば RD/WT を IO モックへ差し替える（emulater_code_test.mdc §7）。
   * `type: "handshake"` で 1階ボードモック、`type: "port"` でポート単位の固定値。
   */
  ioMock?: CodeTestIoMockEntry[];
};

export type Tms9995CodeTestOptions = {
  /** ワークスペース先頭（バイト）。既定 0xFE00 */
  workspaceByteAddr?: number;
  /** スタックポインタ R10 初期値（バイト）。既定 0xFE00 */
  stackInit?: number;
  /** 戻りスタブ（IDLE）を置くバイトアドレス。既定 0x8100 */
  returnStubByteAddr?: number;
  /** tickCpu の最大回数。既定 100000 */
  maxCycles?: number;
};

/**
 * ポートモックへの 1 回の WT 記録。
 * @see CodeTestIoMock.writes
 */
export type CodeTestIoWriteLog = {
  /** IO ポート番号（16bit） */
  port: number;
  /** 書き込んだ 16bit 値 */
  value: number;
};

/**
 * 設定 JSON の IO モック 1 エントリ。
 * handshake は 1 件まで。port は RD 固定値／キューと WT 記録。
 */
export type CodeTestIoMockEntry =
  | {
      type: "handshake";
      /** 各信号待ちのタイムアウト ms（既定は IO モック側） */
      timeoutMs?: number;
      /** HSHK_IN_REQ を IRQ2 に連動（既定 false。コードテストはポーリング想定） */
      syncIrq2?: boolean;
      /** true なら CPU→IO 受信ループを start() する（既定 false） */
      start?: boolean;
      /** タイマー駆動。省略時はグローバル setTimeout（テストでは inert を渡す） */
      timerScheduler?: IoTimerScheduler;
    }
  | {
      type?: "port";
      /** IO ポート番号（10進 / `"0x24"` / `"0b…"`） */
      port: number | string;
      /**
       * RD の戻り。数値なら毎回同じ。配列なら読むたびに次へ進み、尽きたら最後を繰り返す。
       * 省略時は handshake または既定 `0xFFFF` にフォールバック。
       */
      read?: number | string | Array<number | string>;
    };

/**
 * HEX / CDB ハーネスを JSON から起こす設定。
 * `ioMock` があればエミュレータの RD/WT コールバックをキックする。
 */
export type CodeTestSettings = {
  hexFile?: string;
  cdbFile?: string;
  /** ファイルの代わりにインライン Intel HEX */
  hexText?: string;
  /** ファイルの代わりにインライン CDB */
  cdbText?: string;
  stackInit?: number | string;
  returnStubWordAddr?: number | string;
  maxCycles?: number | string;
  memoryBytes?: number | string;
  /** ゼロページ（ワードアドレス文字列 → ワード値） */
  zeroPage?: Record<string, number | string>;
  /** 1 件以上あれば IO モックをアタッチ */
  ioMock?: CodeTestIoMockEntry[];
};

export type StackWorkExpect = {
  /** preCallSp からの差分（+1 で 1 ワード上＝アドレス増） */
  from: "preCallSp";
  offset: number;
  words: number[];
};

export type CdbSymbol = {
  name: string;
  /** CDB 上のバイトアドレス */
  byteAddr: number;
  /** ワードアドレス（byteAddr/2） */
  wordAddr: number;
  scope: "G" | "F" | "L" | string;
};

/**
 * CDB の `L:__CP$name$serial:addr`（`; @cp`。アセンブララベルではない）。
 * 根拠: asm_editor.mdc / asm_test_framework.mdc
 */
export type CdbCheckpoint = {
  /** `__CP$uart_initialized$0001` */
  id: string;
  /** `; @cp` 名 */
  name: string;
  /** 同名識別 4 桁（0001 起算） */
  serial: string;
  /** CDB 上のバイトアドレス（偶数） */
  byteAddr: number;
  /** ワードアドレス（byteAddr/2） */
  wordAddr: number;
};
