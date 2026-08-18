import * as vscode from "vscode";
import { getPreferredArchitecture } from "./cpu/registry";
import { AsmDiagnostics } from "./diagnostics/undefinedLabels";
import { createDefinitionProvider } from "./providers/definition";
import { createCallHoverProvider } from "./providers/hover";
import { registerNoOpFormatter } from "./providers/noopFormatter";
import { createReferenceProvider } from "./providers/references";
import { SymbolIndex } from "./symbols/index";
import { registerCheckpointHighlight } from "./ui/checkpointHighlight";
import { registerTodoHighlight } from "./ui/todoHighlight";
import { registerUnwarningHighlight } from "./ui/unwarningHighlight";
import { CpuStatusBar } from "./ui/cpuStatusBar";

/**
 * 拡張機能のエントリポイント。
 * - ワークスペースのラベル / .equ 索引
 * - 未定義ラベル / 未知命令の診断
 * - ステータスバーでの CPU 選択（MN1610 / MN1613 / TMS9995）
 * - `.asm` 先頭の `.cpu` による自動切替（asm-rules.mdc）
 * - 定義へ移動（F12） / 参照へ移動（Shift+F12）
 * - グローバルラベルホバー（宣言側コメント。JSDoc 風なら強調）
 * - サブルーチン呼び出しホバー（呼び出し規約）
 * - 保存時整形でソースを壊さない no-op フォーマッタ
 * - `; @cp` チェックポイントの色分け（asm_editer.mdc）
 * - `; @unwarning` 未使用グローバル警告の抑止
 * - `; TODO` コメントの色分け（概要ルーラー付き）
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Retro Assembler");
  const index = new SymbolIndex();
  const diagnostics = new AsmDiagnostics(index);

  registerNoOpFormatter(context);
  registerCheckpointHighlight(context);
  registerUnwarningHighlight(context);
  registerTodoHighlight(context);

  /** 再初期化を直列化し、索引クリア競合を防ぐ */
  let reinitChain: Promise<void> = Promise.resolve();

  /**
   * シンボル索引の再構築と診断のやり直し（CPU 切替・起動時）。
   * @param reason ログ用理由
   * @returns 完了 Promise
   */
  const reinitialize = (reason: string): Promise<void> => {
    reinitChain = reinitChain.then(async () => {
      try {
        const arch = getPreferredArchitecture();
        const n = await index.rebuild();
        // 非表示タブの `.global` 未使用警告も、他ファイルの BALD 参照を見て消す
        diagnostics.refreshOpen();
        output.appendLine(
          `[${reason}] CPU=${arch.displayName} (${arch.id}), indexed ${n} symbols.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`[${reason}] symbol index rebuild failed: ${msg}`);
      }
    });
    return reinitChain;
  };

  const cpuBar = new CpuStatusBar(() => reinitialize("cpu-changed"));

  output.appendLine("Retro Assembler activated (v0.2.4 .global skip).");
  void reinitialize("activate");

  context.subscriptions.push(
    output,
    diagnostics.disposable,
    ...cpuBar.disposables,
    vscode.languages.registerHoverProvider(
      { language: "mn1613asm" },
      createCallHoverProvider(index),
    ),
    vscode.languages.registerDefinitionProvider(
      { language: "mn1613asm" },
      createDefinitionProvider(index),
    ),
    vscode.languages.registerReferenceProvider(
      { language: "mn1613asm" },
      createReferenceProvider(),
    ),
    vscode.commands.registerCommand("retroAsm.showOutput", () => {
      output.show(true);
    }),
    vscode.commands.registerCommand("retroAsm.rebuildIndex", async () => {
      await reinitialize("rebuild-index");
      const arch = getPreferredArchitecture();
      vscode.window.showInformationMessage(
        `シンボル索引を再構築しました（CPU: ${arch.displayName}）`,
      );
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== "mn1613asm") return;
      void reinitChain.then(() => diagnostics.refreshOpen());
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId !== "mn1613asm") return;
      // 起動直後は索引が空なので、rebuild 完了まで未使用グローバルを出さない
      void reinitChain.then(() => diagnostics.refresh(doc));
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      void doc;
    }),
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (doc.languageId !== "mn1613asm") return;
      await reinitialize("save");
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      await reinitialize("workspace-folders");
    }),
  );
}

export function deactivate(): void {}
