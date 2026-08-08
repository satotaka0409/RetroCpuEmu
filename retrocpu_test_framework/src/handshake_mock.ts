/**
 * テストフレームワークの IO モック（emulater_code_test.mdc の ioMock エントリに従う）
 * 根拠: test_framework.mdc / emulater_code_test.mdc §7
 */

import { CodeTestIoMock } from "../../retrocpu_emu/src/main/feature/code_test/io_mock.js";
import type { CodeTestIoMockEntry } from "../../retrocpu_emu/src/main/feature/code_test/types.js";
import type { IoBoardHandshakeMock } from "../../retrocpu_emu/src/main/feature/board/handshake/io_board_mock.js";
import type { IoBoardMockOptions } from "../../retrocpu_emu/src/main/feature/board/handshake/io_board_mock.js";
import type { IoTimerHandle, IoTimerScheduler } from "../../retrocpu_emu/src/main/feature/board/io_timer.js";

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
 * handshake エントリにフレームワーク既定（timeout / syncIrq2 / inert タイマー）を足す。
 * @param entries 設定の ioMock
 * @returns RD/WT キック用エントリ
 */
export function withFrameworkIoMockDefaults(
  entries: CodeTestIoMockEntry[],
): CodeTestIoMockEntry[] {
  return entries.map((e) => {
    if (e.type !== "handshake") {
      return e;
    }
    return {
      ...e,
      timeoutMs: e.timeoutMs ?? 5000,
      syncIrq2: e.syncIrq2 ?? false,
      timerScheduler: e.timerScheduler ?? createInertTimerScheduler(),
    };
  });
}

/**
 * ioMock の handshake エントリ相当で RD/WT をキックする（設定を使わない場合の互換 API）。
 * 新規テストは `JsonTestSettings.ioMock` + `createSessionFromSettings` を使う。
 * @param options syncIrq2 / タイマースケジューラ等
 * @returns アタッチ済みハンドシェイクモック（afterEach で stop / detach）
 */
export function attachHandshakeMock(
  options: IoBoardMockOptions = {},
): IoBoardHandshakeMock {
  const mock = new CodeTestIoMock(
    withFrameworkIoMockDefaults([
      {
        type: "handshake",
        timeoutMs: options.timeoutMs ?? 5000,
        syncIrq2: options.syncIrq2 ?? false,
        timerScheduler: options.timerScheduler ?? createInertTimerScheduler(),
      },
    ]),
  );
  mock.attach();
  if (!mock.handshake) {
    throw new Error("attachHandshakeMock: handshake mock was not created");
  }
  return mock.handshake;
}

export type { IoBoardHandshakeMock, IoBoardMockOptions, CodeTestIoMockEntry };
