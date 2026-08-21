/** MN1613 IO / 階間バス信号（ハンドシェイク線はハードどおり 0/1） */
export interface CpuIoSignals {
  /**
   * output 割り込み処理中フラグ
   * IO:0x20 の bit0 に反映される
   */
  INTERRUPT_BUSY: 0 | 1;

  /**
   * 割り込み要因（IO:0x21）
   * Bit0: INT1 要因（0=ブレイク, 1=ステップ）
   * Bit1-2: INT2 要因（00=タイマー, 01=ハンドシェイク）
   */
  INT_CAUSE: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

  /** CPU->IO データ有効（CPU 出力） */
  HSHK_OUT_DENA: 0 | 1;

  /** CPU->IO データ受信完了（IO 入力） */
  HSHK_OUT_DACK: 0 | 1;

  /** IO->CPU データ有効（IO 出力） */
  HSHK_IN_DENA: 0 | 1;

  /** IO->CPU データ受信完了（CPU 出力） */
  HSHK_IN_DACK: 0 | 1;

  /** CPU→IO 割り込み要求 */
  HSHK_OUT_REQ: 0 | 1;

  /** IO→CPU 割り込み要求 */
  HSHK_IN_REQ: 0 | 1;

  /**
   * CPU→IO データ（ラッチ後の1バイト。シリアライズは CLK×8 でモデル化可）
   */
  HSHK_IN_DATA: number;

  /**
   * IO→CPU データ（ラッチ後の1バイト）
   */
  HSHK_OUT_DATA: number;

  /** 共有同期クロック（HSHK / DMA 兼用。常時刻んでもよい） */
  CLK: 0 | 1;
}
