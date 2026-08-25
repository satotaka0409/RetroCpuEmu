/**
 * CPU ボード CPLD 相当のステップ実行ワンショット
 * 根拠: breakpoint.mdc「ステップ実行」/ MN1613_CPUボードメモリ_IOマップ.mdc（0036/0037）
 *
 * 命令フェッチ（エミュは _executeOne 先頭の 1 語）だけ見る。データ READ は見ない。
 * ヒット時は呼び出し側が INT1・INT1_CAUSE=1 を上げる。
 */

/** IO:0036 — ステップ ENABLE（Bit0。ヒット後 CPLD が 0） */
export const IO_PORT_STEP_ENA = 0x0036;
/** IO:0037 — ステップ割り込みディレイ（8bit） */
export const IO_PORT_STEP_DELAY = 0x0037;

/** 1命令ステップ用の既定ディレイ値（ハード仕様に合わせたラッチ初期値） */
export const STEP_BRK_DELAY_1STEP = 0x01;

/**
 * ステップ用 CPLD。
 * ENA=1 かつ delay カウントが 0 に達したときワンショット IRQ を上げる。
 */
export class StepBreakUnit {
  private ena = 0;
  private delay = STEP_BRK_DELAY_1STEP;
  private remaining = 0;
  private skipFirstFetch = false;
  private onHit: (() => void) | null = null;

  /**
   * ヒット時の通知先を登録する。
   * @param cb INT2 を上げる側。null で解除
   */
  setOnHit(cb: (() => void) | null): void {
    this.onHit = cb;
  }

  /** ENA=0・ディレイ初期値に戻す */
  reset(): void {
    this.ena = 0;
    this.delay = STEP_BRK_DELAY_1STEP;
    this.remaining = 0;
    this.skipFirstFetch = false;
  }

  /**
   * ENABLE ラッチ（Bit0）。
   * @returns 0 または 1
   */
  getEnable(): number {
    return this.ena;
  }

  /** ラッチされたディレイ値（8bit） */
  getDelayCount(): number {
    return this.delay & 0xff;
  }

  /** 現在の残りカウント（テスト用） */
  getRemainingCount(): number {
    return this.remaining & 0xff;
  }

  /**
   * 1 命令の先頭語フェッチ。2 語目やオペランド READ では呼ばない。
   * @param word フェッチした命令語（16bit）
   */
  onInstructionFetch(_word: number): void {
    if (this.ena === 0) {
      return;
    }

    // 仕様: DELAY 書き込み後の次クロックからカウント開始。
    // エミュレータでは「次の命令フェッチから開始」として扱う。
    if (this.skipFirstFetch) {
      this.skipFirstFetch = false;
      return;
    }

    if (this.remaining > 0) {
      this.remaining = (this.remaining - 1) & 0xff;
    }
    if (this.remaining === 0) {
      this.ena = 0;
      this.onHit?.();
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
    if (p === IO_PORT_STEP_DELAY) return this.delay & 0xff;
    return null;
  }

  /**
   * IO ライト（0036/0037）。
   * ENA=1 で現在の delay 値を再ロードしてカウント開始する。
   * @param port ポート番号
   * @param val 16bit
   * @returns 処理したら true
   */
  writePort(port: number, val: number): boolean {
    const p = port & 0xffff;
    const v = val & 0xffff;
    if (p === IO_PORT_STEP_ENA) {
      this.ena = v & 1;
      if (this.ena !== 0) {
        // 実機の「次クロックからカウント開始」を命令フェッチ近似すると
        // 1命令ぶん早く発火しやすいため、+1オフセットで整合を取る。
        this.remaining = ((this.delay & 0xff) + 1) & 0xff;
        this.skipFirstFetch = true;
      } else {
        this.remaining = 0;
        this.skipFirstFetch = false;
      }
      return true;
    }
    if (p === IO_PORT_STEP_DELAY) {
      this.delay = v & 0xff;
      return true;
    }
    return false;
  }
}

/** CPU ボード共有のステップ・ワンショット */
export const stepBreak = new StepBreakUnit();
