/** CPUの種別（`.cpu` / `--cpu` で指定できるのはこの3つのみ） */
export type CpuType = "mn1610" | "mn1613" | "tms9995";

/** PC / ラベルのアドレス単位 */
export type AddressUnit = "word" | "byte";

/** シンボルの可視性 */
export type SymbolKind = "local" | "global" | "external";

/** シンボル情報（値はワードアドレス。external は 0） */
export interface SymbolInfo {
  value: number;
  kind: SymbolKind;
  /** ラベルが属する `.area`（`.equ` は無し） */
  area?: string;
}

/** 大文字化したシンボル名をキーにした定義済みシンボル値（ワード） */
export type SymbolTable = Map<string, number>;

/** 大文字化したシンボル名をキーにしたシンボル情報表 */
export type SymbolInfoTable = Map<string, SymbolInfo>;

/**
 * ワード差リロケーションのオペランド。
 * - symbol: 外部/グローバル。T は 0、R3_SYM。リンク後に ÷2 してワードへ
 * - word: モジュール内オフセット（T はバイト＝ワード×2、R3_AREA）
 * - const: 絶対定数（領域基底を足さない）
 */
export type RelocOperand =
  | { kind: "symbol"; name: string }
  | { kind: "word"; value: number; /** オフセットの属する領域。省略時はパッチ先領域 */ area?: string }
  | { kind: "const"; value: number };

/** リロケーションの書き込み幅 */
export type RelocWidth = "word16" | "low8";

/**
 * アドレス差をリンク時に埋めるリロケーション。
 * 値 = resolve(left) - resolve(right)（いずれもワード数）。
 */
export interface WordDiffReloc {
  /** パッチ先のバイトアドレス（領域内オフセット） */
  byteAddr: number;
  left: RelocOperand;
  right: RelocOperand;
  /** パッチ先の `.area`。省略時は `_CODE` */
  area?: string;
  /**
   * 書き込み幅。省略時は word16（R3_WORD）。
   * low8 は命令語の下位 8bit だけ（R3_BYTE。`*label` ゼロページ）。
   */
  width?: RelocWidth;
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
  /** 領域内アドレス（MN161x: ワード / TMS: バイト） */
  address: number;
  /** 16bit値 */
  value: number;
  lineNo: number;
  source: string;
  /** 属する `.area`（未宣言時は `_CODE`） */
  area: string;
}

/** アセンブル結果の 1 領域 */
export interface AreaInfo {
  name: string;
  /** アドレス単位でのサイズ（MN161x: ワード / TMS: バイト） */
  size: number;
  noload: boolean;
}

/** アセンブル結果一式（出力語・シンボル・元ソース） */
export interface AssemblyResult {
  words: EmittedWord[];
  /** 定義済みシンボルのワード値（external は含まない） */
  symbols: SymbolTable;
  /** local / global / external を含むシンボル情報 */
  symbolInfos: SymbolInfoTable;
  /** 外部を含むアドレス引き算・絶対アドレス（BALD / .dw 等）のリロケーション */
  relocs: WordDiffReloc[];
  /** `.area` ごとのサイズ（リンク順に並べる） */
  areas: AreaInfo[];
  sourceLines: SourceLine[];
  /**
   * `.ds` / `.blkw` 行の先頭ロケーション（行番号 → アドレス）。
   * LST 用。イメージには出さない（MN161x: ワード / TMS: バイト）。
   */
  storageAddrs: Map<number, number>;
  /** アセンブル対象 CPU */
  cpuType: CpuType;
  /**
   * EmittedWord.address / シンボル値の単位。
   * MN161x: word、TMS9995: byte
   */
  addressUnit: AddressUnit;
  /**
   * `; @cp` チェックポイント（ラベルではない。領域内アドレス）。
   * REL はグローバル `S __CP$name$serial Def....`（sdld が無視しない）
   */
  checkpoints: AsmCheckpoint[];
}

/** `; @cp`（アセンブララベルではない） */
export interface AsmCheckpoint {
  name: string;
  /** 同名 4 桁（0001 起算） */
  serial: string;
  area: string;
  /** MN161x: ワード / TMS: バイト */
  address: number;
}
