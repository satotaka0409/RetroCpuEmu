/**
 * MN1613 逆アセンブラの公開型
 * 根拠: MN1613.mdc / asm-rules.mdc / asm_test_framework.mdc
 */

/** ワードアドレスとラベル名のペア（初期化・手動登録用） */
export type Mn1613LabelPair = {
  /** ラベル名 */
  name: string;
  /** ワードアドレス（16bit） */
  wordAddr: number;
};

/** 1 命令の逆アセンブル結果 */
export type Mn1613DisassembleResult = {
  /** 逆アセンブル文字列（ラベル解決済み、asm-rules 推奨書式） */
  text: string;
  /** 消費したワード数（1 または 2） */
  wordCount: number;
  /** 次命令のワードアドレス */
  nextAddr: number;
};

/** 逆アセンブラ初期化オプション */
export type Mn1613DisassemblerOptions = {
  /** ラベル一覧（ワードアドレス）。CDB より後に適用して上書きできる */
  labels?: Iterable<Mn1613LabelPair>;
  /** SDCC CDB テキスト（`L:` レコード。アドレスはバイト） */
  cdbText?: string;
};

/** ワードアドレスから 16bit 命令／データを読む */
export type Mn1613ReadWord = (wordAddr: number) => number;
