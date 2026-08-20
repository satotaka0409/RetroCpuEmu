import * as vscode from "vscode";
import { pickDefinitionSymbols } from "../symbols/definitionPick";
import type { SymbolIndex } from "../symbols/index";
import { isAsmLanguageId } from "../languageIds";

const IDENT_RE = /[A-Za-z_.$][A-Za-z0-9_.$]*/;

/**
 * 定義へ移動（F12 / 右クリック「定義へ移動」）。
 * ラベル本体（`name:`）と `.equ` へ飛ぶ。`.global` 行は対象にしない。
 * @param index - シンボル索引
 * @return DefinitionProvider
 */
export function createDefinitionProvider(
	index: SymbolIndex,
): vscode.DefinitionProvider {
	return {
		provideDefinition(document, position) {
			if (!isAsmLanguageId(document.languageId))
				return undefined;

			const wordRange = document.getWordRangeAtPosition(
				position,
				IDENT_RE,
			);
			if (!wordRange) return undefined;

			const name = document.getText(wordRange).toUpperCase();
			const defs = pickDefinitionSymbols(index.lookup(name));
			if (defs.length === 0) return undefined;

			return defs.map(
				(sym) =>
					new vscode.Location(
						vscode.Uri.parse(sym.uri),
						new vscode.Position(
							sym.line,
							0,
						),
					),
			);
		},
	};
}
