import {
  createIoBoardHandshakeMock,
  type IoBoardHandshakeMock,
  type IoBoardMockOptions,
} from "@emu/main/feature/board/handshake/io_board_mock";
import type { IoTimerHandle, IoTimerScheduler } from "@emu/main/feature/board/io_timer";

/**
 * タイマー満了を起こさないスケジューラ（19h 設定の検証専用）。
 * @returns 何もしないスケジューラ
 */
export function createInertTimerScheduler(): IoTimerScheduler {
  let nextId = 1;
  return {
    setTimeout: () => nextId++ as unknown as IoTimerHandle,
    clearTimeout: () => {},
  };
}

/**
 * IO ボードハンドシェイクモックを CPU の RD/WT に接続する。
 * @param options syncIrq2 / タイマースケジューラ等
 * @returns アタッチ済みモック（afterEach で stop / detach）
 */
export function attachHandshakeMock(
  options: IoBoardMockOptions = {},
): IoBoardHandshakeMock {
  return createIoBoardHandshakeMock({
    timeoutMs: options.timeoutMs ?? 5000,
    syncIrq2: options.syncIrq2 ?? false,
    timerScheduler: options.timerScheduler ?? createInertTimerScheduler(),
    handlers: options.handlers,
    maxLog: options.maxLog,
    onLog: options.onLog,
  });
}

export type { IoBoardHandshakeMock, IoBoardMockOptions };
