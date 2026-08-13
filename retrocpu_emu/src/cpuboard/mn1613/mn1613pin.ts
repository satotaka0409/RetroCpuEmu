/** MN1613 CPUピン状態（スナップショット。true = Enable） */

export interface CpuPins {
  /** Input ハルト */
  HLT: boolean;
  /** Output ラン */
  RUN: boolean;
  /** Input 割り込み要求 IRQ0-2 */
  IRQ0: boolean;
  IRQ1: boolean;
  IRQ2: boolean;
  /** Input リセット */
  RST: boolean;
  /** Input バスアベイラブル等（仕様対象） */
  BSAV: boolean;
  /** Input スタート */
  STRT: boolean;
  /** Output I/O アクセス中 */
  IOP: boolean;
  /** Output バス要求 */
  BSRQ: boolean;
  /** Output ライト */
  WRT: boolean;
}
