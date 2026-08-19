import * as vscode from "vscode";
import {
  getPreferredArchitecture,
  listSelectableCpus,
  setPreferredCpuId,
} from "../cpu/registry";
import { scanSourceCpuId } from "../cpu/parseCpuDirective";

const CONFIG_KEY = "retroAsm.defaultCpu";

/**
 * 左下ステータスバーの CPU 選択 UI。
 * アクティブな `.asm` 先頭の `.cpu` があれば自動でそれに合わせる。
 */
export class CpuStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[];
  /** 自動切替で上書き中か（設定既定とは別） */
  private autoFromCpu = false;

  /**
   * @param onCpuChanged - CPU 変更後に呼ぶ再初期化コールバック
   */
  constructor(private readonly onCpuChanged: () => Promise<void>) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = "retroAsm.selectCpu";
    this.syncFromConfiguration();
    this.item.show();

    this.subscriptions = [
      this.item,
      vscode.commands.registerCommand("retroAsm.selectCpu", () =>
        this.pickCpu(),
      ),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration(CONFIG_KEY)) return;
        if (this.autoFromCpu) return;
        this.syncFromConfiguration();
        void this.onCpuChanged();
      }),
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        this.syncFromEditor(ed);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const active = vscode.window.activeTextEditor;
        if (!active || active.document !== e.document) return;
        if (e.document.languageId !== "mn1613asm") return;
        this.syncFromEditor(active);
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        const active = vscode.window.activeTextEditor;
        if (active?.document === doc) this.syncFromEditor(active);
      }),
    ];

    this.syncFromEditor(vscode.window.activeTextEditor);
  }

  /**
   * Disposable 群（extension の subscriptions へ）。
   * @return 登録用
   */
  get disposables(): readonly vscode.Disposable[] {
    return this.subscriptions;
  }

  /**
   * 設定値をレジストリとステータスバー表示へ反映する。
   */
  syncFromConfiguration(): void {
    this.autoFromCpu = false;
    const id = vscode.workspace
      .getConfiguration("retroAsm")
      .get<string>("defaultCpu", "mn1613");
    const arch = setPreferredCpuId(id);
    this.item.text = `$(cpu) ${arch.displayName}`;
    this.item.tooltip = `Retro Assembler CPU: ${arch.displayName}\nクリックで切り替え（.asm 先頭の .cpu があれば自動）`;
  }

  /**
   * アクティブエディタの先頭 `.cpu` に合わせて CPU を切り替える。
   * `.cpu` が無ければ設定の既定に戻す。
   * @param editor - 対象（無ければ設定既定）
   */
  syncFromEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== "mn1613asm") {
      if (this.autoFromCpu) {
        const prev = getPreferredArchitecture().id;
        this.syncFromConfiguration();
        if (getPreferredArchitecture().id !== prev) {
          void this.onCpuChanged();
        }
      }
      return;
    }

    const fromCpu = scanSourceCpuId(editor.document.getText());
    if (!fromCpu) {
      if (this.autoFromCpu) {
        const prev = getPreferredArchitecture().id;
        this.syncFromConfiguration();
        if (getPreferredArchitecture().id !== prev) {
          void this.onCpuChanged();
        }
      }
      return;
    }

    const prev = getPreferredArchitecture().id;
    const arch = setPreferredCpuId(fromCpu);
    this.autoFromCpu = true;
    this.item.text = `$(cpu) ${arch.displayName}`;
    this.item.tooltip = `ソース先頭の .cpu ${arch.id} より自動切替\nクリックで既定 CPU を手動選択`;
    if (arch.id !== prev) {
      void this.onCpuChanged();
    }
  }

  /**
   * QuickPick で CPU を選び、設定を更新する。
   */
  async pickCpu(): Promise<void> {
    const current = getPreferredArchitecture();
    const picked = await vscode.window.showQuickPick(
      listSelectableCpus().map((arch) => ({
        label: arch.displayName,
        description: arch.id,
        detail:
          arch.id === "tms9995"
            ? "TMS9995（全命令・sdas 構文）を解釈"
            : "MN1613 を解釈",
        arch,
      })),
      {
        title: "解釈する CPU を選択",
        placeHolder: `現在: ${current.displayName}`,
      },
    );
    if (!picked) return;

    this.autoFromCpu = false;

    const target =
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;

    try {
      await vscode.workspace
        .getConfiguration("retroAsm")
        .update("defaultCpu", picked.arch.id, target);
    } catch {
      await vscode.workspace
        .getConfiguration("retroAsm")
        .update(
          "defaultCpu",
          picked.arch.id,
          vscode.ConfigurationTarget.Global,
        );
    }

    // アクティブファイルに `.cpu` があればそちらを優先表示（既定設定は更新済み）
    this.syncFromEditor(vscode.window.activeTextEditor);
  }

  dispose(): void {
    for (const d of this.subscriptions) d.dispose();
  }
}
