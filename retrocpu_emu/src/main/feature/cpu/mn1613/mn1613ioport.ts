/** MN1613 IO / 階間バス信号（ハンドシェイク線はハードどおり 0/1） */
export interface CpuIoSignals {
  /**
   * output 割り込み処理中フラグ
   * IO:0x20 の bit0 に反映される
   */
  INTERRUPT_BUSY: 0 | 1;

  /**
   * 割り込み要因 0～7 の8要因
   * IO:0x21 の bit0-2 に反映される
   * 0:タイマー割り込み
   * 2:ハンドシェイク
   * 4:アドレスブレイク
   */
  INT_CAUSE: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

  /**
   * ハンドシェイク処理中（旧 HSHK_ACK）
   * 1: 依頼受理／セッション中
   */
  HSHK_ENA: 0 | 1;

  /** データ有効（1バイト転送のトリガ。0→1 で送信開始、1→0 で終了） */
  HSHK_DENA: 0 | 1;

  /** データ受信完了 */
  HSHK_DACK: 0 | 1;

  /** CPU→IO 割り込み要求 */
  HSHK_REQ_0: 0 | 1;

  /** IO→CPU 割り込み要求 */
  HSHK_REQ_1: 0 | 1;

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
