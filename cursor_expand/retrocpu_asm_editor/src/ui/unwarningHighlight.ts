/**
 * `; @unwarning` のエディタ色分け
 */

import * as vscode from "vscode";
import { findUnwarningComment } from "../comments/unwarning";

/**
 * 可視エディタの `; @unwarning` 行を ThemeColor で装飾する。
 * @param context 拡張コンテキスト
 */
export function registerUnwarningHighlight(
  context: vscode.ExtensionContext,
): void {
  const deco = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor("retroAsm.unwarningForeground"),
    backgroundColor: new vscode.ThemeColor("retroAsm.unwarningBackground"),
    fontWeight: "bold",
  });

  /**
   * 1 エディタへ `@unwarning` 装飾を付ける。
   * @param editor 対象
   */
  const apply = (editor: vscode.TextEditor): void => {
    if (editor.document.languageId !== "mn1613asm") {
      editor.setDecorations(deco, []);
      return;
    }
    const ranges: vscode.Range[] = [];
    const doc = editor.document;
    for (let i = 0; i < doc.lineCount; i += 1) {
      const line = doc.lineAt(i);
      const hit = findUnwarningComment(line.text);
      if (!hit) continue;
      ranges.push(
        new vscode.Range(i, hit.commentStart, i, hit.commentEnd),
      );
    }
    editor.setDecorations(deco, ranges);
  };

  /**
   * 可視エディタすべてを更新する。
   */
  const refreshVisible = (): void => {
    for (const editor of vscode.window.visibleTextEditors) {
      apply(editor);
    }
  };

  refreshVisible();

  context.subscriptions.push(
    deco,
    vscode.window.onDidChangeVisibleTextEditors(() => {
      refreshVisible();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== "mn1613asm") return;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === e.document) apply(editor);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId !== "mn1613asm") return;
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === doc) apply(editor);
      }
    }),
  );
}
