import * as vscode from "vscode";
import { detectArchitecture } from "../cpu/registry";
import { isAsmLanguageId } from "../languageIds";
import { collectSymbolOccurrences } from "../symbols/occurrences";

const IDENT_RE = /[A-Za-z_.$][A-Za-z0-9_.$]*/;
const ASM_GLOBS = "**/*.{asm,s,mn1613,tms9995,inc,h}";

/**
 * 参照へ移動（Shift+F12 / 右クリック「参照へ移動」）。
 * ワークスペース内のラベル / .equ 参照を列挙する。
 * @return ReferenceProvider
 */
export function createReferenceProvider(): vscode.ReferenceProvider {
	return {
		async provideReferences(document, position, context) {
			if (!isAsmLanguageId(document.languageId))
				return undefined;

			const wordRange = document.getWordRangeAtPosition(
				position,
				IDENT_RE,
			);
			if (!wordRange) return undefined;
			const name = document.getText(wordRange).toUpperCase();

			const uris = await vscode.workspace.findFiles(
				ASM_GLOBS,
				"**/node_modules/**",
			);
			const locations: vscode.Location[] = [];
			const seen = new Set<string>();

			for (const uri of uris) {
				let doc: vscode.TextDocument;
				try {
					doc =
						await vscode.workspace.openTextDocument(
							uri,
						);
				} catch {
					continue;
				}
				if (!isAsmLanguageId(doc.languageId)) continue;

				const arch = detectArchitecture(
					doc.fileName,
					doc.getText(),
				);
				const occs = collectSymbolOccurrences(
					doc.getText(),
					name,
					arch,
					context.includeDeclaration,
				);
				for (const occ of occs) {
					const key = `${uri.toString()}:${occ.line}:${occ.start}:${occ.end}`;
					if (seen.has(key)) continue;
					seen.add(key);
					locations.push(
						new vscode.Location(
							uri,
							new vscode.Range(
								occ.line,
								occ.start,
								occ.line,
								occ.end,
							),
						),
					);
				}
			}

			return locations.length > 0 ? locations : undefined;
		},
	};
}
