import * as vscode from "vscode";

/**
 * 何も変更しないフォーマッタ。
 * formatOnSave が走ってもアセンブラソースを壊さないためのガード。
 */
export class NoOpFormattingProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider
{
  provideDocumentFormattingEdits(): vscode.TextEdit[] {
    return [];
  }

  provideDocumentRangeFormattingEdits(): vscode.TextEdit[] {
    return [];
  }
}

/**
 * mn1613asm 向けに no-op フォーマッタを登録する。
 * @param context - 拡張コンテキスト
 */
export function registerNoOpFormatter(
  context: vscode.ExtensionContext,
): void {
  const provider = new NoOpFormattingProvider();
  const selector: vscode.DocumentSelector = { language: "mn1613asm" };
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(
      selector,
      provider,
    ),
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      selector,
      provider,
    ),
  );
}
