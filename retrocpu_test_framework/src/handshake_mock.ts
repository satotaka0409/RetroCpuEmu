/**
 * テストフレームワークの IO モック（emulater_code_test.mdc の ioMock エントリに従う）
 * 根拠: test_framework.mdc / emulater_code_test.mdc §7
 */

import { CodeTestIoMock } from "../../retrocpu_emu/src/code_test/io_mock.js";
import type { CodeTestIoMockEntry } from "../../retrocpu_emu/src/code_test/types.js";
import type { IoBoardHandshakeMock } from "../../retrocpu_emu/src/ioboard/handshake/io_board_mock.js";
import type { IoBoardMockOptions } from "../../retrocpu_emu/src/ioboard/handshake/io_board_mock.js";
import type {
  IoTimerHandle,
  IoTimerScheduler,
} from "../../retrocpu_emu/src/ioboard/timer/io_timer.js";

type LegacyReqBus = {
  HSHK_IN_REQ: 0 | 1;
  HSHK_ENA?: 0 | 1;
  HSHK_REQ_1?: 0 | 1;
};

/**
 * タイマー満了を起こさないスケジューラ（12h 設定の検証専用）。
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

/**
 * IO→CPU 要求がアサート中かを判定する（新旧シグナル名互換）。
 * - 新名: HSHK_IN_REQ=1
 * - 旧名: HSHK_REQ_1=1
 * - 受理済み互換: ENA=1（REQ パルスを見逃した後でも受理状態を拾う）
 */
export function isIoToCpuRequestAsserted(mock: IoBoardHandshakeMock): boolean {
  const bus = mock.bus as LegacyReqBus;
  if (bus.HSHK_IN_REQ === 1) return true;
  if (bus.HSHK_REQ_1 === 1) return true;
  return bus.HSHK_ENA === 1;
}

/**
 * IO→CPU 要求が来るまで待つ（新旧シグナル名互換）。
 * @param mock ハンドシェイクモック
 * @param timeoutMs 待機上限 ms（既定 2000）
 */
export async function waitForIoToCpuRequest(
  mock: IoBoardHandshakeMock,
  timeoutMs = 2000,
): Promise<void> {
  const t0 = Date.now();
  while (!isIoToCpuRequestAsserted(mock)) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("timeout waiting IO->CPU request");
    }
    await new Promise((r) => setTimeout(r, 1));
  }
}

export type { IoBoardHandshakeMock, IoBoardMockOptions, CodeTestIoMockEntry };
