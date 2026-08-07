/**
 * Preload: レンダラへ安全な API を公開
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { EmuSnapshotWire } from "../shared/emu_api";

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
  getSnapshot(): Promise<EmuSnapshotWire> {
    return ipcRenderer.invoke("emu:getSnapshot");
  },
  keyHex(digit: string): void {
    ipcRenderer.send("emu:keyHex", digit);
  },
  keyFn(fn: string): void {
    ipcRenderer.send("emu:keyFn", fn);
  },
  loadIntelHex(hex: string): Promise<{ bytesWritten: number }> {
    return ipcRenderer.invoke("emu:loadIntelHex", hex);
  },
});
