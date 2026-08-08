/**
 * アセンブラテストフレームワークの共通型
 * 根拠: .cursor/rules/test_framework.mdc
 */

import type { CodeTestIoMockEntry } from "../../retrocpu_emu/src/main/feature/code_test/types.js";

/** retrocpu_asm が扱う CPU */
export type AsmCpuType = "mn1610" | "mn1613" | "tms9995";

/** 1 モジュール分の入力（ファイルまたはインライン） */
export type AsmSource =
  | {
      /** ソースファイル絶対／相対パス */
      file: string;
      /** REL モジュール名。省略時はファイル名（拡張子なし・大文字） */
      module?: string;
    }
  | {
      /** インラインソース全文 */
      text: string;
      /** REL モジュール名（必須） */
      module: string;
      /** .include 解決の基準ディレクトリ。省略時は CWD */
      fromDir?: string;
    };

/** アセンブル＋リンクの入力 */
export type AssembleLinkOptions = {
  /** リンクするソース */
  sources: AsmSource[];
  /** CPU。既定 mn1613 */
  cpu?: AsmCpuType;
  /**
   * `_CODE` の原点（ワード）。
   * 省略時: ソースに MAIN が無ければ 0x0200 スタブ、あればスタブ無し。
   * 0 ならスタブ無し。
   */
  codeOrgWord?: number;
};

/** HEX / CDB ファイルへ書き出すときの追加指定 */
export type AssembleToFilesOptions = AssembleLinkOptions & {
  /** Intel HEX 出力パス */
  hexFile: string;
  /** CDB 出力パス */
  cdbFile: string;
};

/** 1 モジュールのアセンブル結果（リンク前） */
export type AssembledModule = {
  /** REL モジュール名 */
  module: string;
  /** ソースパス（インラインは仮想名） */
  sourcePath: string;
  /** アセンブル時シンボル（ワード。external は含まない） */
  symbols: Map<string, number>;
};

/** リンク済みイメージとシンボル */
export type LinkedImage = {
  /** 結合後バイト列（ビッグエンディアン、先頭＝領域 0） */
  image: Uint8Array;
  /** グローバル Def（ワードアドレス） */
  globals: Map<string, number>;
  /** グローバル Def（バイトアドレス。CDB と同じ） */
  globalBytes: Map<string, number>;
  /** Intel HEX テキスト */
  hexText: string;
  /** CDB テキスト */
  cdbText: string;
  /** モジュールごとのアセンブル時シンボル */
  modules: AssembledModule[];
};

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
   * 先頭が先に PUSH（最終的にアドレスが高い側）。第3引数は `[count]`。
   */
  stack?: number[];
  /**
   * true なら CPU レジスタを reset() する（メモリ・IO ピンは維持）。
   * 既定 false。
   */
  resetCpu?: boolean;
  /**
   * true なら BALR/RETL 相当で戻る（IC のあと CSBR も積む）。
   * `gl_handshake_interrupt_handler` など割り込みサブルーチン用。既定 false（BALD/RET）。
   */
  retl?: boolean;
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

/** CDB シンボル（テストから参照するとき） */
export type CdbSymbolInfo = {
  name: string;
  /** バイトアドレス */
  byteAddr: number;
  /** ワードアドレス */
  wordAddr: number;
};

/** MN1613 セッション生成オプション */
export type Mn1613SessionOptions = {
  /**
   * Intel HEX パス。テストコードに書く。
   * `sources` があれば生成してここに書く。省略時は `build/session.ihx`。
   */
  hexFile?: string;
  /**
   * CDB パス。テストコードに書く。
   * `sources` があれば生成してここに書く。省略時は `build/session.cdb`。
   */
  cdbFile?: string;
  /**
   * 各テスト前に実行する初期化ラベル（`H` まで）。既定 `gl_main`。
   * `null` なら実行しない（MAIN スタブのみの部分リンクなど）。
   */
  initLabel?: string | null;
  /** あればアセンブル／リンクして hex/cdb を生成してからロード */
  sources?: AsmSource[];
  /** sources 使用時の CPU。既定 mn1613 */
  cpu?: AsmCpuType;
  /** sources 使用時の `_CODE` 原点。MAIN 無ければ既定 0x0200 */
  codeOrgWord?: number;
  /** スタック初期値（空きスロット）。既定 0xFFFF */
  stackInit?: number;
  /** 戻りスタブ（H）のワードアドレス。既定 0x17FE */
  returnStubWordAddr?: number;
  /** run 最大サイクル。既定 2_000_000（ハンドシェイク待ち込み） */
  maxCycles?: number;
  /** メモリバイト数。既定 0x20000（64K ワード） */
  memoryBytes?: number;
  /**
   * IO モック（emulater_code_test.mdc §7）。
   * 1 件以上なら create / reload で RD/WT をキックする。
   */
  ioMock?: CodeTestIoMockEntry[];
};
