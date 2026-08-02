/** MN1613 CPUピン状態 */
export interface CpuPins {
  /** Input ハルト信号 */
  HLT: boolean;
  /** Output ラン信号 */
  RUN: boolean;
  /** Input 割り込み要求信号 IRQ0-2 */
  IRQ0: boolean;
  IRQ1: boolean;
  IRQ2: boolean;
  /** Input リセット信号 */
  RST: boolean;
  /** Output I/O信号(IOポートアクセス時 true) */
  IOP: boolean;
}
