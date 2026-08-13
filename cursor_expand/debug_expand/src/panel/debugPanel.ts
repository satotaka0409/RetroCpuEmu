import * as vscode from "vscode";
import { getDebugHtml } from "./getHtml";
import { createMockDebugState } from "./mockState";
import type { DebugViewState } from "./mockState";
import {
  pickAndLoadProgram,
  ProgramSession,
} from "../load/loadProgramUi";

/**
 * CSP 用の短い nonce を作る。
 * @returns nonce 文字列
 */
function makeNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 32; i += 1) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

/**
 * retrocpu_debug.mdc の基本画面を Webview パネルで開く。
 */
export class DebugPanel {
  public static readonly viewType = "retroDebug.panel";

  private static current: DebugPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private session: ProgramSession | null = null;
  private state: DebugViewState;

  /**
   * 既存パネルを前面にするか、新規作成する。
   * @param extensionUri 拡張ルート
   */
  static show(extensionUri: vscode.Uri): DebugPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (DebugPanel.current) {
      DebugPanel.current.panel.reveal(column);
      return DebugPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      DebugPanel.viewType,
      "Retro CPU Debug",
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    DebugPanel.current = new DebugPanel(panel, extensionUri);
    return DebugPanel.current;
  }

  /**
   * 現在のパネル（無ければ undefined）。
   * @returns パネル
   */
  static active(): DebugPanel | undefined {
    return DebugPanel.current;
  }

  /**
   * @param panel Webview パネル
   * @param extensionUri 拡張ルート
   */
  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.state = createMockDebugState();
    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: { type?: string; cmd?: string }) => {
        if (msg.type === "ready") {
          void this.panel.webview.postMessage({
            type: "state",
            state: this.state,
          });
          return;
        }
        if (msg.type === "command" && msg.cmd === "loadHex") {
          void this.loadProgram();
          return;
        }
        if (msg.type === "command" && msg.cmd) {
          void vscode.window.showInformationMessage(
            `Retro CPU Debug: 「${msg.cmd}」は未実装`,
          );
        }
      },
      null,
      this.disposables,
    );
  }

  /**
   * HEX / CDB を選んで画面を更新する。
   */
  async loadProgram(): Promise<void> {
    const loaded = await pickAndLoadProgram();
    if (!loaded) return;
    this.session = loaded.session;
    this.state = loaded.state;
    void this.panel.webview.postMessage({ type: "state", state: this.state });
    const cdbNote = this.session.cdbPath
      ? pathBase(this.session.cdbPath)
      : "CDB なし";
    void vscode.window.showInformationMessage(
      `読込完了: ${pathBase(this.session.hexPath)} / ${cdbNote} / entry=${this.session.entryWord.toString(16).toUpperCase()}h (${this.session.hexInfo?.bytesWritten ?? 0} bytes)`,
    );
  }

  /**
   * HTML を組み立てる。
   * @returns HTML
   */
  private buildHtml(): string {
    const { webview } = this.panel;
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "debug.css"),
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "debug.js"),
    );
    return getDebugHtml(
      nonce,
      webview.cspSource,
      cssUri.toString(),
      jsUri.toString(),
      this.state,
    );
  }

  /** パネルを破棄する */
  dispose(): void {
    DebugPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

/**
 * パス末尾だけ取る。
 * @param p パス
 * @returns ファイル名
 */
function pathBase(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}
