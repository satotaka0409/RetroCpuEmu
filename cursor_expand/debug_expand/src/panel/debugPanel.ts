import * as vscode from "vscode";
import { getDebugHtml } from "./getHtml";
import {
  createMockDebugState,
  DEFAULT_ENTRY_WORD,
  hex5,
  makeMemDumpRows,
  memDumpFromBeBytes,
  memFetchRange,
  memNextCenter,
  MEM_WORDS_PER_ROW,
  PHYS_WORD_MASK,
  type DebugViewState,
} from "./mockState";
import {
  pickAndLoadProgram,
  ProgramSession,
} from "../load/loadProgramUi";
import { entryLabelName } from "../load/programSession";
import { DebugIoClient } from "../net/debugIo";

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
  private readonly log: vscode.OutputChannel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private session: ProgramSession | null = null;
  private state: DebugViewState;
  private io: DebugIoClient | null = null;
  private ioBusy = false;
  private memQueued: { center: number; scrollTo: number } | null = null;
  private disasmQueued: { center: number; scrollTo: number } | null = null;
  private readonly entryReady: Promise<number>;

  /**
   * 既存パネルを前面にするか、新規作成する。
   * @param extensionUri 拡張ルート
   * @param log 出力チャネル
   */
  static show(
    extensionUri: vscode.Uri,
    log?: vscode.OutputChannel,
  ): DebugPanel {
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

    DebugPanel.current = new DebugPanel(panel, extensionUri, log);
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
   * @param log 出力チャネル
   */
  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    log?: vscode.OutputChannel,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.log = log;
    this.state = createMockDebugState();
    this.session = new ProgramSession();
    this.entryReady = this.bootstrapSession();
    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: {
        type?: string;
        cmd?: string;
        addr?: number;
        firstAddr?: number;
        lastAddr?: number;
      }) => {
        if (msg.type === "ready") {
          void this.onWebviewReady();
          return;
        }
        if (msg.type === "command" && msg.cmd === "loadHex") {
          void this.loadProgram();
          return;
        }
        if (msg.type === "command" && msg.cmd === "gotoMem") {
          const addr = Number(msg.addr) || 0;
          void this.requestMemWindow(addr, addr);
          return;
        }
        if (msg.type === "memScroll") {
          this.onMemScroll(Number(msg.firstAddr), Number(msg.lastAddr));
          return;
        }
        if (msg.type === "disasmScroll") {
          this.onDisasmScroll(Number(msg.firstAddr), Number(msg.lastAddr));
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
   * 初期表示を g_main（または HEX 最小）から逆アセンブルし、handshake 13h で読む。
   */
  private async onWebviewReady(): Promise<void> {
    const entry = await this.entryReady;
    this.state = {
      ...this.state,
      memStart: entry,
      disasmStart: entry,
    };
    void this.panel.webview.postMessage({
      type: "state",
      state: this.state,
    });
    await this.requestMemWindow(entry, entry);
    await this.requestDisasmWindow(entry, entry);
  }

  /**
   * ワークスペースのモニタ IHX/CDB をセッションに載せる。
   * @returns 逆アセンブル先頭の物理ワード
   */
  private async bootstrapSession(): Promise<number> {
    const session = this.session ?? new ProgramSession();
    this.session = session;
    try {
      const cdbFiles = await vscode.workspace.findFiles(
        "**/mn1613_mon.cdb",
        "**/node_modules/**",
        8,
      );
      if (cdbFiles.length === 0) {
        this.log?.appendLine(
          `entry: mn1613_mon.cdb なし → ${hex5(DEFAULT_ENTRY_WORD)}h`,
        );
        session.entryWord = DEFAULT_ENTRY_WORD;
        return DEFAULT_ENTRY_WORD;
      }
      const cdbUri = cdbFiles[0]!;
      const ihxPath = cdbUri.fsPath.replace(/\.cdb$/i, ".ihx");
      try {
        const ihxBytes = await vscode.workspace.fs.readFile(
          vscode.Uri.file(ihxPath),
        );
        session.loadHex(Buffer.from(ihxBytes).toString("utf8"), ihxPath);
        this.log?.appendLine(`hex: ${ihxPath}`);
      } catch {
        this.log?.appendLine(`hex: ${ihxPath} なし（13h 待ち）`);
      }
      const cdbText = Buffer.from(
        await vscode.workspace.fs.readFile(cdbUri),
      ).toString("utf8");
      session.loadCdb(cdbText, cdbUri.fsPath);
      const word = (session.entryWord || DEFAULT_ENTRY_WORD) & PHYS_WORD_MASK;
      const name = entryLabelName(session) ?? "HEX最小";
      this.log?.appendLine(
        `entry: ${cdbUri.fsPath} ${name}=${hex5(word)}h`,
      );
      return word;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log?.appendLine(`entry: 読込失敗 ${msg} → ${hex5(DEFAULT_ENTRY_WORD)}h`);
      session.entryWord = DEFAULT_ENTRY_WORD;
      return DEFAULT_ENTRY_WORD;
    }
  }

  /**
   * 可視範囲がキャッシュ端に出たら、中心をずらして再取得する。
   * @param firstAddr 可視先頭ワード
   * @param lastAddr 可視末尾ワード
   */
  onMemScroll(firstAddr: number, lastAddr: number): void {
    if (
      !Number.isFinite(firstAddr) ||
      !Number.isFinite(lastAddr) ||
      lastAddr < firstAddr
    ) {
      return;
    }
    const center = memNextCenter(
      firstAddr & PHYS_WORD_MASK,
      lastAddr & PHYS_WORD_MASK,
      this.state.memCacheLo,
      this.state.memCacheHi,
    );
    if (center === null) {
      return;
    }
    const win = memFetchRange(center);
    if (
      win.lo === this.state.memCacheLo &&
      win.hi === this.state.memCacheHi
    ) {
      return;
    }
    void this.requestMemWindow(center, firstAddr & PHYS_WORD_MASK);
  }

  /**
   * 逆アセンブル可視範囲がキャッシュ端に出たら再取得する。
   * @param firstAddr 可視先頭ワード
   * @param lastAddr 可視末尾ワード
   */
  onDisasmScroll(firstAddr: number, lastAddr: number): void {
    if (
      !Number.isFinite(firstAddr) ||
      !Number.isFinite(lastAddr) ||
      lastAddr < firstAddr
    ) {
      return;
    }
    const center = memNextCenter(
      firstAddr & PHYS_WORD_MASK,
      lastAddr & PHYS_WORD_MASK,
      this.state.disasmCacheLo,
      this.state.disasmCacheHi,
    );
    if (center === null) {
      return;
    }
    const win = memFetchRange(center);
    if (
      win.lo === this.state.disasmCacheLo &&
      win.hi === this.state.disasmCacheHi
    ) {
      return;
    }
    void this.requestDisasmWindow(center, firstAddr & PHYS_WORD_MASK);
  }

  /**
   * 進行中の 13h が終わったら、残っているダンプ／逆アセンブル要求を続ける。
   */
  private drainIoQueue(): void {
    const mem = this.memQueued;
    this.memQueued = null;
    if (mem) {
      void this.requestMemWindow(mem.center, mem.scrollTo);
      return;
    }
    const dis = this.disasmQueued;
    this.disasmQueued = null;
    if (dis) {
      void this.requestDisasmWindow(dis.center, dis.scrollTo);
    }
  }

  /**
   * ±800h 窓を取得してダンプを更新する（進行中なら最新要求だけ残す）。
   * @param centerWord 窓の中心
   * @param scrollTo 再描画後に合わせるワード
   */
  async requestMemWindow(centerWord: number, scrollTo: number): Promise<void> {
    const center = centerWord & PHYS_WORD_MASK;
    const scroll = scrollTo & PHYS_WORD_MASK;
    if (this.ioBusy) {
      this.memQueued = { center, scrollTo: scroll };
      return;
    }
    this.ioBusy = true;
    try {
      await this.fetchMemWindow(center, scroll);
    } finally {
      this.ioBusy = false;
      this.drainIoQueue();
    }
  }

  /**
   * ±800h 窓を取得して逆アセンブルを更新する（進行中なら最新要求だけ残す）。
   * @param centerWord 窓の中心
   * @param scrollTo 再描画後に合わせるワード
   */
  async requestDisasmWindow(centerWord: number, scrollTo: number): Promise<void> {
    const center = centerWord & PHYS_WORD_MASK;
    const scroll = scrollTo & PHYS_WORD_MASK;
    if (this.ioBusy) {
      this.disasmQueued = { center, scrollTo: scroll };
      return;
    }
    this.ioBusy = true;
    try {
      await this.fetchDisasmWindow(center, scroll);
    } finally {
      this.ioBusy = false;
      this.drainIoQueue();
    }
  }

  /**
   * IO→CPU ハンドシェイク 13h で窓を読む。失敗時は 0 埋め（モックは出さない）。
   * @param centerWord 中心
   * @param scrollTo スクロール先
   */
  private async fetchMemWindow(
    centerWord: number,
    scrollTo: number,
  ): Promise<void> {
    const win = memFetchRange(centerWord);
    const read = await this.readPhysWindow(win, "mem");
    this.state = {
      ...this.state,
      memStart: scrollTo & PHYS_WORD_MASK,
      memCacheLo: win.lo,
      memCacheHi: win.hi,
      memDump: read.dump,
      memNote: read.memNote,
    };
    void this.panel.webview.postMessage({
      type: "mem",
      memDump: read.dump,
      memStart: this.state.memStart,
      memCacheLo: win.lo,
      memCacheHi: win.hi,
      memNote: read.memNote,
      scrollToAddr: this.state.memStart,
    });
  }

  /**
   * 13h で窓を読み、その範囲を逆アセンブルする。
   * @param centerWord 中心
   * @param scrollTo スクロール先
   */
  private async fetchDisasmWindow(
    centerWord: number,
    scrollTo: number,
  ): Promise<void> {
    const win = memFetchRange(centerWord);
    const read = await this.readPhysWindow(win, "disasm");
    const disasm = this.ensureSession().buildDisasm(
      win.lo,
      win.wordCount,
      win.hi,
      scrollTo & PHYS_WORD_MASK,
    );
    this.state = {
      ...this.state,
      disasm,
      disasmStart: scrollTo & PHYS_WORD_MASK,
      disasmCacheLo: win.lo,
      disasmCacheHi: win.hi,
      memNote: read.memNote,
    };
    void this.panel.webview.postMessage({
      type: "disasm",
      disasm,
      disasmStart: this.state.disasmStart,
      disasmCacheLo: win.lo,
      disasmCacheHi: win.hi,
      memNote: read.memNote,
      scrollToAddr: this.state.disasmStart,
    });
  }

  /**
   * 物理ワード窓を 13h で読む。ダンプ行も返す。
   * @param win 取得範囲
   * @param kind ログ用
   * @returns ダンプとメモ
   */
  private async readPhysWindow(
    win: { lo: number; hi: number; wordCount: number },
    kind: "mem" | "disasm",
  ): Promise<{ dump: DebugViewState["memDump"]; memNote: string }> {
    const cfg = vscode.workspace.getConfiguration("retroDebug");
    const host = cfg.get<string>("host") ?? "127.0.0.1";
    const port = cfg.get<number>("port") ?? 29000;
    let dump = makeMemDumpRows(
      win.lo,
      Math.ceil(win.wordCount / MEM_WORDS_PER_ROW),
      () => 0,
    );
    let memNote = this.state.memNote;
    try {
      const io = this.requireIo(host, port);
      this.log?.appendLine(
        `${kind} 13h ${host}:${port} word ${hex5(win.lo)}–${hex5(win.hi)} (${win.wordCount} words)`,
      );
      const bytes = await io.memRead(win.lo * 2, win.wordCount * 2);
      dump = memDumpFromBeBytes(win.lo, bytes);
      this.ensureSession().patchBytes(win.lo * 2, bytes);
      memNote = `handshake 13h OK  ${hex5(win.lo)}–${hex5(win.hi)}`;
      this.log?.appendLine(memNote);
    } catch (e) {
      this.io?.close();
      this.io = null;
      const msg = e instanceof Error ? e.message : String(e);
      memNote = `未接続 — retrocpu_emu を起動（DebugHost ${host}:${port}）。${msg}`;
      this.log?.appendLine(memNote);
    }
    return { dump, memNote };
  }

  /**
   * プログラムセッションを用意する。
   * @returns セッション
   */
  private ensureSession(): ProgramSession {
    if (!this.session) this.session = new ProgramSession();
    return this.session;
  }

  /**
   * 設定のホスト／ポートで IO クライアントを用意する。
   * @param host TCP ホスト
   * @param port TCP ポート
   * @returns クライアント
   */
  private requireIo(host: string, port: number): DebugIoClient {
    if (this.io) return this.io;
    this.io = new DebugIoClient(host, port);
    return this.io;
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
    void this.requestMemWindow(this.state.memStart, this.state.memStart);
    void this.requestDisasmWindow(this.state.disasmStart, this.state.disasmStart);
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
    this.io?.close();
    this.io = null;
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
