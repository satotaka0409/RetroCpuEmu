/**
 * CPU ボード CPLD 相当のステップ実行ワンショット
 * 根拠: breakpoint.mdc「ステップ実行」/ MN1613_CPUボードメモリ_IOマップ.mdc（0036/0037）
 *
 * 命令フェッチ（エミュは _executeOne 先頭の 1 語）だけ見る。データ READ は見ない。
 * ヒット時は呼び出し側が INT1・INT1_CAUSE=1 を上げる。
 */

/** IO:0036 — ステップ ENABLE（Bit0。ヒット後 CPLD が 0） */
export const IO_PORT_STEP_ENA = 0x0036;
/** IO:0037 — トリガ命令語 */
export const IO_PORT_STEP_COM = 0x0037;

/** 既定トリガ: LPSW 2（`00100 000 0000 0110`） */
export const STEP_BRK_COM_LPSW2 = 0x2006;

type StepPhase = "idle" | "armed";

/**
 * ステップ用 CPLD。ENA=1 のときトリガ命令の次の命令フェッチでワンショット IRQ。
 */
export class StepBreakUnit {
  private ena = 0;
  private com = STEP_BRK_COM_LPSW2;
  private phase: StepPhase = "idle";
  private onHit: (() => void) | null = null;

  /**
   * ヒット時の通知先を登録する。
   * @param cb INT2 を上げる側。null で解除
   */
  setOnHit(cb: (() => void) | null): void {
    this.onHit = cb;
  }

  /** ENA=0・トリガ=LPSW2・idle に戻す */
  reset(): void {
    this.ena = 0;
    this.com = STEP_BRK_COM_LPSW2;
    this.phase = "idle";
  }

  /**
   * ENABLE ラッチ（Bit0）。
   * @returns 0 または 1
   */
  getEnable(): number {
    return this.ena;
  }

  /**
   * トリガ命令語。
   * @returns 16bit
   */
  getTriggerWord(): number {
    return this.com;
  }

  /**
   * 待ち状態。テスト用。
   * @returns idle=トリガ待ち / armed=次命令フェッチで発火
   */
  getPhase(): StepPhase {
    return this.phase;
  }

  /**
   * 1 命令の先頭語フェッチ。2 語目やオペランド READ では呼ばない。
   * @param word フェッチした命令語（16bit）
   */
  onInstructionFetch(word: number): void {
    if (this.ena === 0) {
      this.phase = "idle";
      return;
    }
    const ir = word & 0xffff;
    if (this.phase === "armed") {
      this.ena = 0;
      this.phase = "idle";
      this.onHit?.();
      return;
    }
    if (ir === (this.com & 0xffff)) {
      this.phase = "armed";
    }
  }

  /**
   * IO リード（0036/0037）。
   * @param port ポート番号
   * @returns 16bit。対象外は null
   */
  readPort(port: number): number | null {
    const p = port & 0xffff;
    if (p === IO_PORT_STEP_ENA) return this.ena;
    if (p === IO_PORT_STEP_COM) return this.com & 0xffff;
    return null;
  }

  /**
   * IO ライト（0036/0037）。ENA=0 で武装解除。ENA=1 はトリガ待ちからやり直す。
   * @param port ポート番号
   * @param val 16bit
   * @returns 処理したら true
   */
  writePort(port: number, val: number): boolean {
    const p = port & 0xffff;
    const v = val & 0xffff;
    if (p === IO_PORT_STEP_ENA) {
      this.ena = v & 1;
      this.phase = "idle";
      return true;
    }
    if (p === IO_PORT_STEP_COM) {
      this.com = v;
      return true;
    }
    return false;
  }
}

/** CPU ボード共有のステップ・ワンショット */
export const stepBreak = new StepBreakUnit();
