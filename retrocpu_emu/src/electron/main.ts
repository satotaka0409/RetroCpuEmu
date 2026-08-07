/**
 * Electron メインプロセス
 * CPU / IO を別 Worker で起動し、IO ボード画面を開く。
 */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { EmuHost } from "../main/feature/board/emu_host";
import type { EmuSnapshot } from "../main/feature/board/emu_types";

/** esbuild CJS 出力では __dirname が使える */
declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
let host: EmuHost | null = null;
let unsub: (() => void) | null = null;

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

function broadcastSnapshot(snap: EmuSnapshot): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("emu:snapshot", snap);
}

app.whenReady().then(async () => {
  host = new EmuHost({
    workerDir: __dirname,
    cpuStepsPerSlice: 32,
    cpuSliceMs: 4,
    ioSliceMs: 16,
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
  unsub?.();
  unsub = null;
  void host?.stop();
  host = null;
  if (process.platform !== "darwin") app.quit();
});
