/**
 * Preload: レンダラへ安全な API を公開
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { BeepWire, EmuSnapshotWire } from "../shared/emu_api";

contextBridge.exposeInMainWorld("emuApi", {
  onSnapshot(callback: (snap: EmuSnapshotWire) => void): () => void {
    /**
     * IPC イベントからスナップショットだけを取り出してコールバックへ渡す。
     * @param _event IPC イベント（未使用）
     * @param snap 受信したスナップショット
     */
    const handler = (_event: IpcRendererEvent, snap: EmuSnapshotWire) => {
      callback(snap);
    };
    ipcRenderer.on("emu:snapshot", handler);
    return () => {
      ipcRenderer.removeListener("emu:snapshot", handler);
    };
  },
  onBeep(callback: (beep: BeepWire) => void): () => void {
    /**
     * IPC から 19h の周波数・長さを取り出してコールバックへ渡す。
     * @param _event IPC イベント（未使用）
     * @param beep 受信した BEEP パラメータ
     */
    const handler = (_event: IpcRendererEvent, beep: BeepWire) => {
      callback(beep);
    };
    ipcRenderer.on("emu:beep", handler);
    return () => {
      ipcRenderer.removeListener("emu:beep", handler);
    };
  },
  getSnapshot(): Promise<EmuSnapshotWire> {
    return ipcRenderer.invoke("emu:getSnapshot");
  },
  keyHex(digit: string): void {
    ipcRenderer.send("emu:keyHex", digit);
  },
  /**
   * 16進キーの押し続けをメインへ送る（14h ビットマップ）。
   * @param digit "0"〜"F"
   * @param down true=押下、false=離す
   */
  keyHexHold(digit: string, down: boolean): void {
    ipcRenderer.send("emu:keyHexHold", digit, down);
  },
  keyFn(fn: string): void {
    ipcRenderer.send("emu:keyFn", fn);
  },
  keyAdsLongPress(): void {
    ipcRenderer.send("emu:keyAdsLongPress");
  },
  loadIntelHex(hex: string): Promise<{
    bytesWritten: number;
    minAddr: number;
    maxAddr: number;
    chunks: number;
  }> {
    return ipcRenderer.invoke("emu:loadIntelHex", hex);
  },
});
