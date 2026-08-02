/** CPUの種別 */
export type CpuType = "mn1610" | "mn1613" | "tms9995";

/** PC / ラベルのアドレス単位 */
export type AddressUnit = "word" | "byte";

/** シンボルの可視性 */
export type SymbolKind = "local" | "global" | "external";

/** シンボル情報（値はワードアドレス。external は 0） */
export interface SymbolInfo {
  value: number;
  kind: SymbolKind;
}

/** 大文字化したシンボル名をキーにした定義済みシンボル値（ワード） */
export type SymbolTable = Map<string, number>;

/** 大文字化したシンボル名をキーにしたシンボル情報表 */
export type SymbolInfoTable = Map<string, SymbolInfo>;

/**
 * ワード差リロケーションのオペランド。
 * - symbol: 外部/グローバルの Def（バイト）をリンク時にワードへ変換
 * - word: モジュール内のワードアドレス（ローカル等、アセンブル時確定）
 */
export type RelocOperand =
  | { kind: "symbol"; name: string }
  | { kind: "word"; value: number };

/**
 * アドレス差をリンク時に埋めるリロケーション。
 * 値 = resolve(left) - resolve(right)（いずれもワード数）。
 */
export interface WordDiffReloc {
  /** パッチ先のバイトアドレス（モジュール内） */
  byteAddr: number;
  left: RelocOperand;
  right: RelocOperand;
}

/** 元ソース1行分（行番号付き） */
export interface SourceLine {
  lineNo: number;
  text: string;
}

/** パース後の1行表現（ラベル/命令/引数） */
export interface ParsedLine extends SourceLine {
  label?: string;
  op?: string;
  args: string[];
}

/** ソース行に対応づいた出力1ワード */
export interface EmittedWord {
  /** ワードアドレス */
  address: number;
  /** 16bit値 */
  value: number;
  lineNo: number;
  source: string;
}

/** アセンブル結果一式（出力語・シンボル・元ソース） */
export interface AssemblyResult {
  words: EmittedWord[];
  /** 定義済みシンボルのワード値（external は含まない） */
  symbols: SymbolTable;
  /** local / global / external を含むシンボル情報 */
  symbolInfos: SymbolInfoTable;
  /** 外部を含むアドレス引き算のリロケーション */
  relocs: WordDiffReloc[];
  sourceLines: SourceLine[];
  /** アセンブル対象 CPU */
  cpuType: CpuType;
  /**
   * EmittedWord.address / シンボル値の単位。
   * MN161x: word、TMS9995: byte
   */
  addressUnit: AddressUnit;
}
