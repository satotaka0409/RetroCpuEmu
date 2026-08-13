import * as vscode from "vscode";
import { DebugPanel } from "./panel/debugPanel";

/**
 * Retro CPU デバッグ拡張のエントリ。
 * 根拠: retrocpu_debug.mdc
 * @param context 拡張コンテキスト
 */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Retro CPU Debug");

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand("retroDebug.openPanel", () => {
      DebugPanel.show(context.extensionUri);
      output.appendLine("[openPanel] debug view");
    }),
    vscode.commands.registerCommand("retroDebug.loadProgram", async () => {
      const panel = DebugPanel.show(context.extensionUri);
      await panel.loadProgram();
      output.appendLine("[loadProgram] HEX/CDB loaded");
    }),
    vscode.commands.registerCommand("retroDebug.showOutput", () => {
      output.show(true);
    }),
  );

  // Extension Development Host 起動直後に画面が出るようにする
  DebugPanel.show(context.extensionUri);
  output.appendLine("Retro CPU Debug activated (panel opened).");
}

export function deactivate(): void {}
