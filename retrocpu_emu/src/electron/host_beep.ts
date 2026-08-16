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
 * @param params 周波数 Hz と長さ ms
 * @returns 再生プロセスを起動できたら true（Web Audio に回す必要なし）
 */
export function playHostBeep(params: BeepWire): boolean {
  stopHostBeep();
  const action = resolveBeepAction(params);
  if (action.type === "stop") {
    return existsSync(POWERSHELL);
  }
  const durationMs = action.stopAfterMs ?? 60_000;
  if (!existsSync(POWERSHELL)) {
    return false;
  }
  const freq = action.frequencyHz;
  const cmd = `[console]::Beep(${freq},${durationMs})`;
  log.info("BEEP を Windows で再生", { frequencyHz: freq, durationMs });
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
