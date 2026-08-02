import * as vscode from "vscode";
import {
  getPreferredArchitecture,
  listSelectableCpus,
  setPreferredCpuId,
} from "../cpu/registry";

const CONFIG_KEY = "retroAsm.defaultCpu";

/**
 * 左下ステータスバーの CPU 選択 UI。
 */
export class CpuStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly subscriptions: vscode.Disposable[];

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
        this.syncFromConfiguration();
        void this.onCpuChanged();
      }),
    ];
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
    const id = vscode.workspace
      .getConfiguration("retroAsm")
      .get<string>("defaultCpu", "mn1613");
    const arch = setPreferredCpuId(id);
    this.item.text = `$(cpu) ${arch.displayName}`;
    this.item.tooltip = `Retro Assembler CPU: ${arch.displayName}\nクリックで切り替え`;
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
          arch.id === "mn1610"
            ? "MN1610 命令セットのみ解釈"
            : arch.id === "tms9995"
              ? "TMS9995（第1弾命令・TI 風構文）を解釈"
              : "MN1613（MN1610 上位互換）を解釈",
        arch,
      })),
      {
        title: "解釈する CPU を選択",
        placeHolder: `現在: ${current.displayName}`,
      },
    );
    if (!picked || picked.arch.id === current.id) return;

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
  }

  dispose(): void {
    for (const d of this.subscriptions) d.dispose();
  }
}
