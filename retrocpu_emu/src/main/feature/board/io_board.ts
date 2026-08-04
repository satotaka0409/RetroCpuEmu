/**
 * IOボード側の1ティック（スタブ）
 * retrocpu_emu.mdc: 2-1〜2-3
 *
 * DMA / 本格ハンドシェイク接続は後続。ここではフック点のみ。
 */

export type IoBoardHooks = {
  /** CPU→IO 割り込み要求（HSHK_REQ_0 相当）がアサートされた */
  onCpuToIoRequest?: () => void;
  /** キーボード走査など */
  onKeyboardPoll?: () => void;
};

let _hooks: IoBoardHooks = {};
let _cpuToIoReq = false;
let _cpuToIoReqPrev = false;

export function setIoBoardHooks(hooks: IoBoardHooks): void {
  _hooks = hooks;
}

/** 2階側から見た REQ 相当（後でバスに接続） */
export function setCpuToIoRequest(asserted: boolean): void {
  _cpuToIoReq = asserted;
}

export function tickIoBoard(): void {
  // 2-1: レトロCPUボードからの割り込み要求監視
  if (_cpuToIoReq && !_cpuToIoReqPrev) {
    _hooks.onCpuToIoRequest?.();
  }
  _cpuToIoReqPrev = _cpuToIoReq;

  // 2-2 DMA: 未実装（開始したら完了まで独占する想定）

  // 2-3 キーボード
  _hooks.onKeyboardPoll?.();
}
