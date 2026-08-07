/**
 * Electron メインプロセス
 * CPU / IO を別 Worker で起動し、IO ボード画面を開く。
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { EmuHost } from "../main/feature/board/emu_host";
import type { EmuSnapshot } from "../main/feature/board/emu_types";
import {
  getLogFilePath,
  getLogger,
  initLogging,
} from "../main/feature/log/logger";

/** esbuild CJS 出力では __dirname が使える */
declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
let host: EmuHost | null = null;
let unsub: (() => void) | null = null;

const logDir = path.join(app.getPath("userData"), "logs");
initLogging({ source: "main", dir: logDir });
const log = getLogger("main");

/** 二重起動防止: 2 つ目は既存ウィンドウを前面にして終了 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn("すでに起動済みのため終了する");
  app.quit();
} else {
  app.on("second-instance", () => {
    log.info("二重起動を検知したので既存ウィンドウを前面にする");
    if (!mainWindow) {
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

/** IO ボード画面のウィンドウを開く（サンドボックス + preload 経由の API のみ） */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 920,
    minWidth: 640,
    minHeight: 720,
    title: "IO Board",
    backgroundColor: "#141517",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * スナップショットをレンダラへ転送する（ウィンドウが無ければ何もしない）。
 * @param snap EmuHost から届いた最新状態
 */
function broadcastSnapshot(snap: EmuSnapshot): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("emu:snapshot", snap);
}

if (gotLock) {
  app.whenReady().then(async () => {
    log.info("IO ボードを起動する", { logFile: getLogFilePath() });

    host = new EmuHost({
      workerDir: __dirname,
      cpuStepsPerSlice: 32,
      cpuSliceMs: 4,
      ioSliceMs: 16,
      logDir,
    });
    unsub = host.subscribe(broadcastSnapshot);
    ipcMain.handle("emu:getSnapshot", () => host!.getSnapshot());
    ipcMain.on("emu:keyHex", (_e, digit: string) => host?.keyHex(digit));
    ipcMain.on("emu:keyFn", (_e, fn: string) => host?.keyFn(fn));
    ipcMain.handle("emu:loadIntelHex", (_e, hex: string) =>
      host!.loadIntelHex(hex),
    );

    await host.start();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    log.info("ウィンドウが全て閉じたので停止する");
    unsub?.();
    unsub = null;
    void host?.stop();
    host = null;
    if (process.platform !== "darwin") app.quit();
  });

  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", { err: err.message, stack: err.stack });
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", { reason: String(reason) });
  });
}
