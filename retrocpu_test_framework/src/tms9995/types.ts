/**
 * TMS9995 呼び出し規約テスト用の型。
 * 実行エミュレータ非依存で、引数配置とレジスタ制約を検証する。
 */

/** 16bit レジスタ配列（R0..R15）。 */
export type Tms9995RegisterFile = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** スタックに積む 1 ワード（バイトアドレス基準）。 */
export type Tms9995StackWord = {
  /** 書き込み先バイトアドレス（偶数）。 */
  byteAddr: number;
  /** 16bit 値。 */
  value: number;
  /** 元の引数番号（0 始まり）。 */
  argIndex: number;
};

/** 引数 i がどこへ配置されたか。 */
export type Tms9995ArgLocation =
  | {
      kind: "register";
      argIndex: number;
      reg: number;
      value: number;
    }
  | {
      kind: "stack";
      argIndex: number;
      byteAddr: number;
      value: number;
    };

/** 検証で検出した規約違反。 */
export type Tms9995CallDiagnostics = {
  /** 禁止レジスタに引数を割り当てた。 */
  forbiddenArgRegisters: number[];
  /** 重複レジスタ割り当て。 */
  duplicatedArgRegisters: number[];
  /** R0..R15 以外。 */
  outOfRangeArgRegisters: number[];
};

/** 呼び出し規約プラン結果。 */
export type Tms9995CallPlan = {
  /** 呼び出し前にセットすべき R0..R15。 */
  registers: Tms9995RegisterFile;
  /** 呼び出し直前の SP（R10）。 */
  spAfterPush: number;
  /** 呼び出し前の元 SP。 */
  spBeforePush: number;
  /** スタックへ積むワード列（書き込み順）。 */
  stackWords: Tms9995StackWord[];
  /** 各引数の割り当て先。 */
  argLocations: Tms9995ArgLocation[];
};

/** 呼び出し規約プラン入力。 */
export type Tms9995CallPlanOptions = {
  /** 引数列。 */
  args: number[];
  /** 呼び出し前 SP（R10）。既定 0x8300。 */
  stackInit?: number;
  /** BL 復帰アドレスとして R11 に置く値。既定 0。 */
  returnAddr?: number;
  /**
   * 第1〜n引数を置くレジスタ番号。
   * 既定は R2..R9。
   */
  argRegisters?: number[];
  /**
   * true なら禁止レジスタ割り当てを許可する（既定 false）。
   * 既定では R0/R1/R10..R15 を引数レジスタとして拒否する。
   */
  allowSpecialPurposeRegisters?: boolean;
};

/** CRU ハンドシェイク線を操作する主体。 */
export type Tms9995CruActor = "cpu" | "io";

/** CRU の 1bit 値。 */
export type Tms9995CruBit = 0 | 1;

/** CPU 出力側（CPU→IO）ハンドシェイク／BUSY 信号名。 */
export type Tms9995CruCpuOutSignal =
  | "HSHK_OUT_REQ"
  | "HSHK_OUT_DENA"
  | "HSHK_IN_DACK"
  | "INTERRUPT_BUSY";

/** CPU 入力側（IO→CPU）ハンドシェイク／要因信号名。 */
export type Tms9995CruCpuInSignal =
  | "HSHK_IN_REQ"
  | "HSHK_IN_DENA"
  | "HSHK_OUT_DACK"
  | "INT1_CAUSE0"
  | "INT1_CAUSE1"
  | "INT2_CAUSE";

/** ハンドシェイク信号名（入出力両方）。 */
export type Tms9995CruSignalName =
  | Tms9995CruCpuOutSignal
  | Tms9995CruCpuInSignal;

/** CRU ビット書き込みログ。 */
export type Tms9995CruWriteLog = {
  actor: Tms9995CruActor;
  bitAddr: number;
  value: Tms9995CruBit;
};

/** CRU ビット読み出しログ。 */
export type Tms9995CruReadLog = {
  actor: Tms9995CruActor;
  bitAddr: number;
  value: Tms9995CruBit;
};

/** CRU ハンドシェイクモックのスナップショット。 */
export type Tms9995CruHandshakeSnapshot = {
  cpuOutSignals: Record<Tms9995CruCpuOutSignal, Tms9995CruBit>;
  cpuInSignals: Record<Tms9995CruCpuInSignal, Tms9995CruBit>;
  outDataByte: number;
  inDataByte: number;
  bits: Record<string, Tms9995CruBit>;
};

/** CRU ハンドシェイクモックの生成オプション。 */
export type Tms9995CruHandshakeOptions = {
  /**
   * true: 役割外アクセスを例外にする（既定）。
   * false: 0x0020..0x003F 内の読み書きをすべて許可。
   */
  strictRoles?: boolean;
};
