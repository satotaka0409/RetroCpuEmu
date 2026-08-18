/**
 * Electron メインプロセス
 * CPU / IO を別 Worker で起動し、IO ボード画面を開く。
 */

import { existsSync } from "node:fs";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { EmuHost } from "./emu_host";
import { resolveBootMonitorHexPath } from "../ioboard/io_reset";
import type { EmuSnapshot } from "../shared/emu_types";
import type { BeepWire } from "../shared/emu_api";
import { playHostBeep, stopHostBeep } from "./host_beep";
import { getLogFilePath, getLogger, initLogging } from "../log/logger";
import {
  createDefaultStartupConfig,
  loadStartupConfigFromArgv,
  saveStartupConfigToSettingArea,
  type StartupConfigLoadResult,
} from "./startup_config";

/** esbuild CJS 出力では __dirname が使える */
declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
let host: EmuHost | null = null;
let unsub: (() => void) | null = null;
let unsubBeep: (() => void) | null = null;

const logDir = path.join(app.getPath("userData"), "logs");
initLogging({ source: "main", dir: logDir });
const log = getLogger("main");

/**
 * WSLg の Pulse ソケットを Chromium に渡す。未設定だと Web Audio が無音になる。
 */
function ensureWslPulseEnv(): void {
  const sock = "/mnt/wslg/PulseServer";
  if (process.env.PULSE_SERVER || !existsSync(sock)) return;
  process.env.PULSE_SERVER = `unix:${sock}`;
  log.info("WSLg Pulse を使う", { PULSE_SERVER: process.env.PULSE_SERVER });
}

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

/**
 * 19h をスピーカーへ出す（WSL は Windows Beep、それ以外はレンダラの Web Audio）。
 * @param beep 周波数 Hz と長さ ms
 */
function broadcastBeep(beep: BeepWire): void {
  log.info("BEEP を再生する", {
    frequencyHz: beep.frequencyHz,
    durationMs: beep.durationMs,
  });
  playHostBeep(beep);
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("emu:beep", beep);
}

/**
 * アプリケーションメニュー（Intel HEX 読込）。
 */
function installMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Open Intel HEX…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            void openIntelHexFile();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * ファイルダイアログで IHX を選び、DMA で 2階 RAM へ書く。
 */
async function openIntelHexFile(): Promise<void> {
  if (!host) return;
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const opts: Electron.OpenDialogOptions = {
    title: "Open Intel HEX",
    properties: ["openFile"],
    filters: [
      { name: "Intel HEX", extensions: ["ihx", "hex", "ihex"] },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const picked = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts);
  if (picked.canceled || !picked.filePaths[0]) return;
  const filePath = picked.filePaths[0];
  try {
    const hex = await fs.readFile(filePath, "utf8");
    const r = await host.loadIntelHex(hex);
    log.info("Intel HEX を読み込んだ", { filePath, ...r });
    const range =
      r.bytesWritten <= 0
        ? "No data records in this file."
        : `DMA wrote ${r.bytesWritten} bytes (${r.chunks} span(s), ` +
          `${r.minAddr.toString(16).toUpperCase()}h–${r.maxAddr.toString(16).toUpperCase()}h).`;
    await showHexDialog({
      type: r.bytesWritten > 0 ? "info" : "warning",
      title: "Intel HEX",
      message: path.basename(filePath),
      detail: range,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("Intel HEX 読込失敗", { filePath, err: msg });
    await showHexDialog({
      type: "error",
      title: "Intel HEX",
      message: "Failed to load Intel HEX",
      detail: msg,
    });
  }
}

/**
 * メッセージボックスを出す。
 * @param box 内容
 */
async function showHexDialog(box: Electron.MessageBoxOptions): Promise<void> {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  if (win) await dialog.showMessageBox(win, box);
  else await dialog.showMessageBox(box);
}

if (gotLock) {
  ensureWslPulseEnv();
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
  app.whenReady().then(async () => {
    log.info("IO ボードを起動する", { logFile: getLogFilePath() });
    installMenu();

    const settingAreaPath = path.join(
      app.getPath("userData"),
      "ioboard_setting_area.bin",
    );

    let startup: StartupConfigLoadResult = {
      ...createDefaultStartupConfig(),
      source: "default",
    };
    try {
      startup = await loadStartupConfigFromArgv(process.argv);
    } catch (e) {
      log.warn("起動 JSON の読み込みに失敗したため既定値を使う", {
        err: e instanceof Error ? e.message : String(e),
      });
    }

    await saveStartupConfigToSettingArea(settingAreaPath, startup);
    log.info("起動設定を適用", {
      source: startup.source,
      configPath: startup.configPath,
      cpuType: startup.settings.cpuType,
      clockDiv: startup.settings.clockDiv,
      resetVector: startup.settings.resetVector,
      emulatePort: startup.emulatePort,
      settingAreaPath,
    });

    let bootMonitorHex: string | undefined;
    try {
      bootMonitorHex = resolveBootMonitorHexPath(
        process.env.RETROCPU_BOOT_MONITOR_HEX,
      );
      log.info("ブートモニタ IHX", { bootMonitorHex });
    } catch (e) {
      log.warn("ブートモニタ IHX を解決できない（RST 時に失敗する）", {
        err: e instanceof Error ? e.message : String(e),
      });
    }

    host = new EmuHost({
      workerDir: __dirname,
      cpuStepsPerSlice: 32,
      cpuSliceMs: 4,
      ioSliceMs: 16,
      logDir,
      bootMonitorHex,
      settingAreaPath,
      debugPort: startup.emulatePort,
    });
    unsub = host.subscribe(broadcastSnapshot);
    unsubBeep = host.subscribeBeep(broadcastBeep);
    ipcMain.handle("emu:getSnapshot", () => host!.getSnapshot());
    ipcMain.on("emu:keyHex", (_e, digit: string) => host?.keyHex(digit));
    ipcMain.on("emu:keyFn", (_e, fn: string) => host?.keyFn(fn));
    ipcMain.on("emu:keyAdsLongPress", () => host?.keyAdsLongPress());
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
    unsubBeep?.();
    unsubBeep = null;
    stopHostBeep();
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
