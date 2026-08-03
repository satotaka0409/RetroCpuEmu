/** MN1613 IO 信号（ハンドシェイク線はハードどおり 0/1） */
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
   */
  INT_CAUSE: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

  /**
   * ハンドシェイク信号
   * HSHK_ACK 1:ハンドシェイク要求に応えたこと/ハンドシェイク処理中であることを示す
   */
  HSHK_ACK: 0 | 1;

  /**
   * ハンドシェイク信号
   * HSHK_DENA 0/1:データが有効であることを示す
   */
  HSHK_DENA: 0 | 1;

  /**
   * ハンドシェイク信号
   * HSHK_REQ_0 1:CPU->IO ハンドシェイクの要求があることを示す
   */
  HSHK_REQ_0: 0 | 1;

  /**
   * ハンドシェイク信号
   * HSHK_REQ_1 1:IO->CPU ハンドシェイクの要求があることを示す
   */
  HSHK_REQ_1: 0 | 1;

  /**
   * ハンドシェイク信号
   * HSHK_DACK 0/1:データを受け取ったことを示す
   */
  HSHK_DACK: 0 | 1;

  /**
   * ハンドシェイク信号
   * HSHK_DATA(0-7の8Bit) 送受信データ（length=1 の Uint8Array）
   */
  HSHK_DATA: Uint8Array;
}
