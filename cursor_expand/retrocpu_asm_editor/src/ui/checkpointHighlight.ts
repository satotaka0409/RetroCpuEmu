/**
 * `; @cp` チェックポイントのエディタ色分け
 * 根拠: asm_editor.mdc（テーマで上書き可能な高コントラスト色）
 */

import * as vscode from "vscode";
import { findCheckpointComment } from "../comments/checkpoint";
import { isAsmLanguageId } from "../languageIds";

/**
 * 可視エディタの `; @cp` 行を ThemeColor で装飾する。
 * @param context 拡張コンテキスト
 */
export function registerCheckpointHighlight(
	context: vscode.ExtensionContext,
): void {
	const deco = vscode.window.createTextEditorDecorationType({
		color: new vscode.ThemeColor("retroAsm.checkpointForeground"),
		backgroundColor: new vscode.ThemeColor(
			"retroAsm.checkpointBackground",
		),
		fontWeight: "bold",
		overviewRulerColor: new vscode.ThemeColor(
			"retroAsm.checkpointForeground",
		),
		overviewRulerLane: vscode.OverviewRulerLane.Right,
	});

	/**
	 * 1 エディタへチェックポイント装飾を付ける。
	 * @param editor 対象
	 */
	const apply = (editor: vscode.TextEditor): void => {
		if (!isAsmLanguageId(editor.document.languageId)) {
			editor.setDecorations(deco, []);
			return;
		}
		const ranges: vscode.Range[] = [];
		const doc = editor.document;
		for (let i = 0; i < doc.lineCount; i += 1) {
			const line = doc.lineAt(i);
			const hit = findCheckpointComment(line.text);
			if (!hit) continue;
			ranges.push(
				new vscode.Range(
					i,
					hit.commentStart,
					i,
					hit.commentEnd,
				),
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
			if (!isAsmLanguageId(e.document.languageId)) return;
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document === e.document)
					apply(editor);
			}
		}),
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (!isAsmLanguageId(doc.languageId)) return;
			for (const editor of vscode.window.visibleTextEditors) {
				if (editor.document === doc) apply(editor);
			}
		}),
	);
}
