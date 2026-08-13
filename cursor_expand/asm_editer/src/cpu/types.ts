/**
 * CPU アーキテクチャ抽象（将来 TMS9995 / Z8002 へ展開）
 */

/** シンボル種別 */
export type AsmSymbolKind = "label" | "equ" | "global";

/** 定義済みシンボル */
export interface AsmSymbol {
  name: string;
  kind: AsmSymbolKind;
  /** 定義ファイル URI */
  uri: string;
  /** 0-based 行 */
  line: number;
  /** サブルーチン向け JSDoc 風コメント（あれば） */
  doc?: SubroutineDoc;
  /** .equ の式（生文字列） */
  expr?: string;
  /** .equ の評価値（解決できた場合） */
  value?: number;
}

/** 呼び出し規約ドキュメント（JSDoc 風） */
export interface SubroutineDoc {
  brief?: string;
  params: Array<{ name: string; description: string }>;
  returns?: string;
  clobbers: string[];
  raw: string;
}

/** CPU 固有の呼び出し規約 */
export interface CallingConvention {
  /** 第1・第2・第3引数レジスタ（アーキテクチャにより個数は異なる） */
  argRegisters: readonly string[];
  /** 戻り値レジスタ（必要な分だけ使う。先頭が主戻り） */
  returnRegisters: readonly string[];
  /**
   * @deprecated `returnRegisters[0]` を使う。後方互換エイリアス。
   */
  returnRegister?: string;
  /** サブルーチン内で退避が必要なレジスタ群の説明 */
  calleeSavedNote: string;
  /** 規約の要約（ホバー用） */
  summaryMarkdown: string;
}

/** アーキテクチャ定義 */
export interface CpuArchitecture {
  id: string;
  displayName: string;
  /** このアーキテクチャとみなす拡張子（先頭の . なし、小文字） */
  extensions: readonly string[];
  languageId: string;
  /** 命令ニーモニック（大文字） */
  mnemonics: ReadonlySet<string>;
  /** アセンブラディレクティブ（大文字、先頭ドット有無両対応） */
  directives: ReadonlySet<string>;
  /** レジスタ名（大文字）。ハイライト・識別用（セグメント／特殊レジスタ含む） */
  registers: ReadonlySet<string>;
  /**
   * 汎用レジスタ（大文字）。`MV` など GPR 専用命令のオペランドに使えるもの。
   * 未指定時は `registers` と同じ（全レジスタが GPR 扱い）。
   */
  gprRegisters?: ReadonlySet<string>;
  /**
   * オペランドのレジスタがすべて GPR でなければならない命令（大文字）。
   * 例: `MV R0, OSR0` はエラー（`CPYB` を使う）。
   */
  gprOnlyMnemonics?: ReadonlySet<string>;
  /** サブルーチン呼び出し命令（大文字） */
  callMnemonics: ReadonlySet<string>;
  /** 分岐などラベル参照しうる命令 */
  labelRefMnemonics: ReadonlySet<string>;
  callingConvention: CallingConvention;
}
