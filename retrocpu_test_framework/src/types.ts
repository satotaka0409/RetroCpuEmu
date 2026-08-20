/**
 * アセンブラテストフレームワークの共通型
 * 根拠: .cursor/rules/asm_test_framework.mdc
 */

/** retrocpu_asm が扱う CPU */
export type AsmCpuType = "mn1613" | "tms9995";

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

/** リンク済みチェックポイント（CDB `__CP$` と同じアドレス） */
export type LinkedCheckpoint = {
  /** `; @cp` の名前 */
  name: string;
  /** 同名識別 4 桁 */
  serial: string;
  /** `__CP$name$serial`（ラベルではない） */
  id: string;
  /** バイトアドレス */
  byteAddr: number;
  /** ワードアドレス */
  wordAddr: number;
};

/** リンク済みイメージとシンボル */
export type LinkedImage = {
  /** 対象 CPU */
  cpu: AsmCpuType;
  /** 結合後バイト列（ビッグエンディアン、先頭＝領域 0） */
  image: Uint8Array;
  /** グローバル Def（ワードアドレス） */
  globals: Map<string, number>;
  /** グローバル Def（バイトアドレス。CDB と同じ。TMS9995 はこちらを優先） */
  globalBytes: Map<string, number>;
  /** Intel HEX テキスト */
  hexText: string;
  /** CDB テキスト */
  cdbText: string;
  /** モジュールごとのアセンブル時シンボル */
  modules: AssembledModule[];
  /** `; @cp` から生成したチェックポイント */
  checkpoints: LinkedCheckpoint[];
};

/** CDB シンボル（テストから参照するとき） */
export type CdbSymbolInfo = {
  name: string;
  /** バイトアドレス */
  byteAddr: number;
  /** ワードアドレス */
  wordAddr: number;
};

/** CDB チェックポイント（`; @cp`。ラベルではない） */
export type CdbCheckpointInfo = {
  /** `__CP$name$serial` */
  id: string;
  /** `; @cp` 名 */
  name: string;
  /** 同名 4 桁 */
  serial: string;
  /** バイトアドレス */
  byteAddr: number;
  /** ワードアドレス */
  wordAddr: number;
};

/**
 * テスト専用 CPU ログの本文モード（`cpuLogFile` があるとき）。
 * - 指定なし（`undefined`）: ケースタイトルの START / END のみ
 * - `checkpoint`: `; @cp` 箇所のみ。実行前・実行後の 2 行
 * - `instruction`: 全命令。実行後のみ 1 行
 */
export type CpuLogMode = "checkpoint" | "instruction";
