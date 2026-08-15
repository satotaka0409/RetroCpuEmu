/**
 * CPU Worker のスライス計画。
 * 通常は stepsPerSlice / sliceMs。ハンドシェイク中は連続実行（delay 0・大きいバースト）。
 * データ面は CpuHandshakeAgent の waitCondition が tick する。スライスは IRQ 入口の保険。
 */

/** 転送中に 1 スライスで進める命令数（IRQ 入口。データ面は waitCondition 側） */
export const HSHK_STEPS_PER_SLICE = 4096;

/** スライス計画 */
export type CpuSlicePlan = {
  /** このスライスで tick する命令数 */
  steps: number;
  /** 次スライスまでの待ち（ms）。0 ならすぐ続ける */
  delayMs: number;
};

/**
 * ハンドシェイクが線上で動いているか（CPU を連続実行すべきか）。
 * ENA だけでなく、受理前の REQ と INT2 処理中も含む。
 * @param bus ハンドシェイクバス
 * @returns 転送中・依頼中なら true
 */
export function handshakeBusyFromBus(bus: {
  HSHK_ENA: number;
  HSHK_REQ_0: number;
  HSHK_REQ_1: number;
  INTERRUPT_BUSY: number;
}): boolean {
  return (
    bus.HSHK_ENA === 1 ||
    bus.HSHK_REQ_0 === 1 ||
    bus.HSHK_REQ_1 === 1 ||
    bus.INTERRUPT_BUSY === 1
  );
}

/**
 * 次スライスの命令数と待ちを決める。
 * @param handshakeBusy ハンドシェイク中なら true
 * @param stepsPerSlice 通常時の命令数
 * @param sliceMs 通常時の間隔（ms）
 * @returns 計画
 */
export function cpuSlicePlan(
  handshakeBusy: boolean,
  stepsPerSlice: number,
  sliceMs: number,
): CpuSlicePlan {
  if (handshakeBusy) {
    return { steps: HSHK_STEPS_PER_SLICE, delayMs: 0 };
  }
  return { steps: stepsPerSlice, delayMs: sliceMs };
}
