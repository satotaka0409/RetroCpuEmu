/**
 * ハンドシェイク 19h を OS のスピーカーで鳴らす。
 * WSL では Chromium Web Audio がデバイスを持てないことが多いので、
 * Windows の [console]::Beep を使う。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveBeepAction, type BeepWire } from "../shared/beep";
import { getLogger } from "../log/logger";

const log = getLogger("beep");

const POWERSHELL =
  "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

/** [console]::Beep の周波数範囲（Hz） */
const BEEP_FREQ_MIN = 37;
const BEEP_FREQ_MAX = 32767;
/** [console]::Beep の長さ上限（ms） */
const BEEP_DUR_MAX = 32767;
/** 無限再生時の 1 回分（ms）。停止指示でプロセスを殺す */
const BEEP_CHUNK_MS = 3000;

let child: ChildProcess | null = null;

/**
 * 進行中のホスト側 BEEP を止める。
 */
export function stopHostBeep(): void {
  if (!child) return;
  child.kill("SIGKILL");
  child = null;
}

/**
 * 19h をホスト OS で再生する。
 * durationMs=0 は停止まで [console]::Beep をチャンク再生する（長さ 0 は例外になる）。
 * @param params 周波数 Hz と長さ ms
 * @returns 再生プロセスを起動できたら true（Web Audio に回す必要なし）
 */
export function playHostBeep(params: BeepWire): boolean {
  stopHostBeep();
  const action = resolveBeepAction(params);
  if (action.type === "stop") {
    return existsSync(POWERSHELL);
  }
  if (!existsSync(POWERSHELL)) {
    return false;
  }
  const freq = Math.max(
    BEEP_FREQ_MIN,
    Math.min(BEEP_FREQ_MAX, action.frequencyHz | 0),
  );
  const stopAfterMs = action.stopAfterMs;
  const infinite = stopAfterMs == null;
  const durationMs =
    stopAfterMs == null
      ? BEEP_CHUNK_MS
      : Math.max(1, Math.min(BEEP_DUR_MAX, stopAfterMs | 0));
  const cmd = infinite
    ? `while ($true) { [console]::Beep(${freq},${BEEP_CHUNK_MS}) }`
    : `[console]::Beep(${freq},${durationMs})`;
  log.info("BEEP を Windows で再生", {
    frequencyHz: freq,
    durationMs: infinite ? 0 : durationMs,
    infinite,
  });
  child = spawn(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-Command", cmd],
    { stdio: "ignore", windowsHide: true },
  );
  child.on("error", (err) => {
    log.warn("BEEP 再生失敗", { err: err.message });
  });
  child.on("exit", () => {
    child = null;
  });
  return true;
}
